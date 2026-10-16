import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { mailFailure, queuePolicy } from "./email-delivery-policy";

@Injectable()
export class BulkEmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BulkEmailQueueService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.error(
          "Email queue processing failed; persisted jobs retained",
        ),
      );
    }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async refreshCampaign(campaignId: string) {
    const rows = await this.prisma.bulkEmailRecipient.findMany({
      where: { campaignId },
      select: { status: true },
    });
    const count = (status: string) =>
      rows.filter((r: any) => r.status === status).length;
    const pending = count("QUEUED") + count("SENDING");
    const sent = count("SENT");
    const failed = count("FAILED") + count("UNCERTAIN");
    await this.prisma.bulkEmailCampaign.update({
      where: { id: campaignId },
      data: {
        successCount: sent,
        failedCount: failed,
        status: pending
          ? "SENDING"
          : failed
            ? sent
              ? "PARTIAL"
              : "FAILED"
            : "COMPLETED",
      },
    });
  }

  async tick(campaignId?: string) {
    const policy = queuePolicy();
    if (!policy.enabled || this.running) return;
    this.running = true;
    try {
      // An interrupted SMTP exchange must never be blindly sent twice.
      const stale = await this.prisma.bulkEmailJob.findMany({
        where: {
          status: "SENDING",
          startedAt: { lt: new Date(Date.now() - 10 * 60_000) },
        },
      });
      for (const job of stale) {
        await this.prisma.$transaction(async (tx: any) => {
          const changed = await tx.bulkEmailJob.updateMany({
            where: { id: job.id, status: "SENDING" },
            data: { status: "UNCERTAIN" },
          });
          if (changed.count)
            await tx.bulkEmailRecipient.update({
              where: { id: job.recipientId },
              data: {
                status: "UNCERTAIN",
                error:
                  "Interrupted delivery; check mailbox/provider logs before retrying.",
              },
            });
        });
        await this.refreshCampaign(job.campaignId);
      }
      const job = await this.prisma.$transaction(async (tx: any) => {
        const locked =
          await tx.$queryRaw`SELECT * FROM "BulkEmailDispatchState" WHERE "id" = 'global' FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return null;
        const state = locked[0],
          now = new Date();
        if (state.nextSendAt > now) return null;
        const hourReset =
          now.getTime() - state.windowStartedAt.getTime() >= 3_600_000;
        const dayReset =
          now.getTime() - state.dayStartedAt.getTime() >= 86_400_000;
        const count = hourReset ? 0 : state.count,
          dayCount = dayReset ? 0 : state.dayCount;
        if (count >= policy.hourly || dayCount >= policy.daily) return null;
        const jobs =
          await tx.$queryRaw`SELECT * FROM "BulkEmailJob" WHERE "status" = 'QUEUED' AND "availableAt" <= NOW() AND (${campaignId || null}::text IS NULL OR "campaignId" = ${campaignId || null}) AND EXISTS (SELECT 1 FROM "BulkEmailCampaign" c WHERE c."id" = "BulkEmailJob"."campaignId" AND c."pausedAt" IS NULL AND c."status" = 'SENDING') ORDER BY "createdAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!jobs.length) return null;
        const next = jobs[0];
        await tx.bulkEmailDispatchState.update({
          where: { id: "global" },
          data: {
            nextSendAt: new Date(now.getTime() + policy.interval * 1000),
            windowStartedAt: hourReset ? now : state.windowStartedAt,
            count: count + 1,
            dayStartedAt: dayReset ? now : state.dayStartedAt,
            dayCount: dayCount + 1,
          },
        });
        await tx.bulkEmailJob.update({
          where: { id: next.id },
          data: {
            status: "SENDING",
            startedAt: now,
            attempts: { increment: 1 },
          },
        });
        await tx.bulkEmailRecipient.update({
          where: { id: next.recipientId },
          data: { status: "SENDING", error: null },
        });
        return { ...next, attempts: next.attempts + 1 };
      });
      if (!job) return;
      const payload = job.payload as any;
      const suppressed = await this.prisma.bulkEmailSuppression.findUnique({
        where: { email: payload.to },
      });
      if (suppressed) {
        await this.finish(job, "SKIPPED", "Suppressed invalid mailbox");
        return;
      }
      let result: any;
      try {
        result = await this.email.sendMail({
          ...payload,
          attachments: (payload.attachments || []).map((a: any) => ({
            ...a,
            content: Buffer.from(a.content, "base64"),
          })),
        });
      } catch (error: any) {
        const failure = mailFailure(error);
        const retry = failure.retry && job.attempts < 4;
        if (failure.suppress)
          await this.prisma.bulkEmailSuppression.upsert({
            where: { email: payload.to },
            update: {},
            create: {
              email: payload.to,
              reason: "SMTP recipient mailbox does not exist",
            },
          });
        const status = failure.uncertain
          ? "UNCERTAIN"
          : retry
            ? "QUEUED"
            : "FAILED";
        await this.prisma.$transaction([
          this.prisma.bulkEmailJob.update({
            where: { id: job.id },
            data: {
              status,
              availableAt: new Date(
                Date.now() + Math.min(60, 2 ** job.attempts) * 60_000,
              ),
            },
          }),
          this.prisma.bulkEmailRecipient.update({
            where: { id: job.recipientId },
            data: {
              status,
              error: failure.uncertain
                ? "Delivery unconfirmed; inspect provider logs before retry."
                : `SMTP ${error?.responseCode || error?.code || "ERROR"}`,
            },
          }),
        ]);
        await this.refreshCampaign(job.campaignId);
        return;
      }
      // Persist acceptance before optional audit logging. A logging error cannot trigger another email.
      await this.prisma.$transaction([
        this.prisma.bulkEmailJob.update({
          where: { id: job.id },
          data: { status: "SENT", messageId: result.messageId, payload: {} },
        }),
        this.prisma.bulkEmailRecipient.update({
          where: { id: job.recipientId },
          data: { status: "SENT", error: null, sentAt: new Date() },
        }),
      ]);
      await this.refreshCampaign(job.campaignId);
      try {
        await this.prisma.customerUnitSelectionLog.createMany({
          data: (payload.unitIds || []).map((id: string) => ({
            unitSelectionId: id,
            section: "COMMUNICATION",
            field: "EMAIL",
            newValue: `Bulk email\nSubject: ${payload.subject}\nRecipient: ${payload.to}\n\n${payload.text}`,
            createdById: payload.actorId,
          })),
        });
      } catch {
        this.logger.warn(
          "Email accepted; unit audit log failed. Do not resend.",
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async finish(job: any, status: string, error: string) {
    await this.prisma.$transaction([
      this.prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: { status, payload: {} },
      }),
      this.prisma.bulkEmailRecipient.update({
        where: { id: job.recipientId },
        data: { status, error },
      }),
    ]);
    await this.refreshCampaign(job.campaignId);
  }
}
