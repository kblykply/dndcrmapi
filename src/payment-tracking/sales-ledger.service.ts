import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import {
  paymentList,
  parsePaymentQuery,
  PaymentTrackingService,
} from './payment-tracking.service';
import {
  normalizeSalesCode,
  salesLedgerAccountKey,
  salesLedgerSnapshot,
} from './sales-ledger-scope';
import type {
  PaymentActor,
  PaymentSourceSnapshot,
} from './payment-tracking.types';

@Injectable()
export class SalesLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly source: PaymentTrackingSourceService,
    private readonly store: PaymentTrackingStoreService,
    private readonly payments: PaymentTrackingService,
  ) {}
  async scoped(actor: PaymentActor, snapshot?: PaymentSourceSnapshot) {
    if (!['SALES', 'ADMIN', 'MANAGER'].includes(actor.role))
      throw new ForbiddenException('Bu alan satışçı hesaplarına açıktır.');
    const [data, mappings, assignments] = await Promise.all([
      snapshot ? Promise.resolve(snapshot) : this.source.snapshot(),
      this.prisma.salesLedgerRepresentative.findMany({
        select: { code: true, userId: true },
      }),
      this.followupAssignments(),
    ]);
    // Only authenticated supervisors may view the full portfolio. Query parameters
    // never influence this access decision.
    const scoped = salesLedgerSnapshot(
      data,
      actor.role === 'SALES' ? actor.id : null,
      mappings,
      assignments,
    );
    const byKey = new Map(assignments.map((row) => [row.key, row]));
    return {
      ...scoped,
      cases: scoped.cases.map((item) => {
        const row = byKey.get(salesLedgerAccountKey(item.identity) ?? '');
        return {
          ...item,
          followupAssignment: {
            userId: row?.userId ?? null,
            userName: row?.userId ? (row.user?.name ?? null) : null,
            changedByName: row?.changedBy?.name ?? null,
            updatedAt: row?.updatedAt.toISOString() ?? null,
            version: row?.version ?? 0,
          },
        };
      }),
    };
  }
  private async followupAssignments() {
    const rows: Prisma.SalesLedgerAssignmentGetPayload<{
      include: {
        user: { select: { id: true; name: true; role: true; isActive: true } };
        changedBy: { select: { name: true } };
      };
    }>[] = await this.prisma.salesLedgerAssignment.findMany({
      include: {
        user: { select: { id: true, name: true, role: true, isActive: true } },
        changedBy: { select: { name: true } },
      },
    });
    // Deactivated users and users who are no longer salespeople cannot gain access.
    return rows.map((row) => ({
      ...row,
      userId:
        row.user?.isActive && row.user.role === 'SALES' ? row.userId : null,
    }));
  }
  private async followupOptions(actor: PaymentActor) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) return [];
    return this.prisma.user.findMany({
      where: { role: 'SALES', isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
  async list(
    actor: PaymentActor,
    raw: Record<string, unknown>,
    exportAll = false,
  ) {
    const parsed = parsePaymentQuery(raw);
    const snapshot = await this.scoped(
      actor,
      await this.source.snapshot(parsed.refresh),
    );
    const states = await this.store.getMany(
      snapshot.cases.map((item) => item.key),
    );
    const query = {
      ...raw,
      invoiceOk: 'value:DND',
      authorizationState: 'blank',
      authorizationCode: '',
    };
    const result = paymentList(
      snapshot,
      states,
      actor,
      exportAll ? { ...query, page: 1, pageSize: 100 } : query,
    );
    if (exportAll) {
      const rows = [...result.rows];
      for (let page = 2; page <= result.totalPages; page++)
        rows.push(
          ...paymentList(snapshot, states, actor, {
            ...query,
            page,
            pageSize: 100,
          }).rows,
        );
      return {
        ...result,
        rows,
        page: 1,
        pageSize: Math.max(1, rows.length),
        totalPages: 1,
        assignees: [],
      };
    }
    return { ...result, assignees: [] };
  }
  async detail(actor: PaymentActor, key: string) {
    const snapshot = await this.scoped(actor);
    const item = snapshot.cases.find((item) => item.key === key);
    if (!item)
      throw new NotFoundException(
        'Cari bulunamadı veya bu cariye erişiminiz yok.',
      );
    const result = await this.payments.describe(snapshot, item);
    return {
      ...result,
      assignees: [],
      followupAssignees: await this.followupOptions(actor),
      canAssignFollowup:
        ['ADMIN', 'MANAGER'].includes(actor.role) &&
        !!salesLedgerAccountKey(item.identity),
    };
  }
  async action(actor: PaymentActor, key: string, body: unknown) {
    const type = (body as { type?: string })?.type;
    if (!type || !['defer', 'reset', 'note', 'contact', 'message_draft', 'message_sent'].includes(type))
      throw new ForbiddenException(
        'Bu işlem satışçı carilerinde kullanılamaz.',
      );
    await this.payments.action(key, body, actor, (snapshot) =>
      this.scoped(actor, snapshot),
    );
    return this.detail(actor, key);
  }
  async assignFollowup(actor: PaymentActor, caseKey: string, input: unknown) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role))
      throw new ForbiddenException(
        'Takip sorumlusunu yalnızca yönetici atayabilir.',
      );
    const body = input as {
      userId?: unknown;
      expectedVersion?: unknown;
    } | null;
    if (
      !body ||
      (body.userId !== null &&
        (typeof body.userId !== 'string' ||
          !body.userId.trim() ||
          body.userId.length > 100)) ||
      !Number.isSafeInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 0
    )
      throw new BadRequestException('Geçerli satışçı ve kayıt sürümü gerekli.');
    const snapshot = await this.scoped(actor, await this.source.snapshot(true));
    const item = snapshot.cases.find((row) => row.key === caseKey);
    if (!item)
      throw new NotFoundException(
        'Cari bulunamadı veya bu cariye erişiminiz yok.',
      );
    const key = salesLedgerAccountKey(item.identity);
    if (!key)
      throw new BadRequestException(
        'Müşteri ve daire kodu eksik; takip sorumlusu atanamaz.',
      );
    const userId = body.userId as string | null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const currentActor = await tx.user.findUnique({
        where: { id: actor.id },
        select: { role: true, isActive: true },
      });
      if (
        !currentActor?.isActive ||
        !['ADMIN', 'MANAGER'].includes(currentActor.role)
      )
        throw new ForbiddenException(
          'Takip sorumlusunu yalnızca aktif yönetici atayabilir.',
        );
      if (userId !== null) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true, isActive: true },
        });
        if (!user?.isActive || user.role !== 'SALES')
          throw new BadRequestException('Aktif bir satışçı seçin.');
      }
      const previous = await tx.salesLedgerAssignment.findUnique({
        where: { key },
      });
      if ((previous?.version ?? 0) !== body.expectedVersion)
        throw new ConflictException(
          'Atama başka bir kullanıcı tarafından değiştirildi. Sayfayı yenileyin.',
        );
      await tx.salesLedgerAssignment.upsert({
        where: { key },
        create: {
          key,
          customerCode: item.identity.customerCode!,
          unitCode: item.identity.unitCode!,
          userId,
          changedById: actor.id,
        },
        update: {
          userId,
          changedById: actor.id,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'SALES_LEDGER_FOLLOWUP_ASSIGNED',
          entityType: 'SalesLedgerAssignment',
          entityId: key,
          metaJson: {
            customerCode: item.identity.customerCode,
            unitCode: item.identity.unitCode,
            previousUserId: previous?.userId ?? null,
            userId,
          },
        },
      });
    });
    return this.detail(actor, caseKey);
  }
  async mappings() {
    const [snapshot, users, mappings, assignments] = await Promise.all([
      this.source.snapshot(),
      this.prisma.user.findMany({
        where: { role: 'SALES', isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.salesLedgerRepresentative.findMany(),
      this.followupAssignments(),
    ]);
    const codes = [
      ...new Set([
        ...snapshot.cases.flatMap((item) =>
          item.representatives.map(normalizeSalesCode).filter(Boolean),
        ),
        ...mappings.map((mapping) => mapping.code),
      ]),
    ].sort();
    const portfolios = users.map((user) => {
      // Use exactly the same ownership and financial scope as the salesperson view.
      const scoped = salesLedgerSnapshot(
        snapshot,
        user.id,
        mappings,
        assignments,
      );
      return {
        userId: user.id,
        accountCount: scoped.cases.length,
        customerCount: new Set(
          scoped.cases
            .map((item) => item.identity.customerCode)
            .filter(Boolean),
        ).size,
        overdueCount: scoped.cases.filter(
          (item) => (item.overdueAmount || 0) > 0,
        ).length,
      };
    });
    return {
      users,
      mappings,
      codes,
      portfolios,
      importedAt: snapshot.importedAt || null,
    };
  }
  async setMapping(code: string, userId: string | null) {
    code = normalizeSalesCode(code);
    if (userId === null) {
      await this.prisma.salesLedgerRepresentative.deleteMany({
        where: { code },
      });
      return { code, userId: null };
    }
    const snapshot = await this.source.snapshot();
    if (
      !snapshot.cases.some((item) =>
        item.representatives.some((rep) => normalizeSalesCode(rep) === code),
      )
    )
      throw new BadRequestException('Satışçı kodu kaynakta yok.');
    if (typeof userId !== 'string' || !userId)
      throw new BadRequestException('Satışçı seçin.');
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'SALES', isActive: true },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Aktif bir satışçı seçin.');
    return this.prisma.salesLedgerRepresentative.upsert({
      where: { code },
      create: { code, userId },
      update: { userId, updatedAt: new Date() },
    });
  }
}
