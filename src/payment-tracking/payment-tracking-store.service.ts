import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  PaymentTrackingCase,
  PaymentTrackingEvent,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PaymentActor,
  PaymentAssignee,
  PaymentIdentity,
  PaymentTrackingAction,
  PaymentTrackingEventDto,
  PaymentTrackingState,
} from './payment-tracking.types';

export interface PaymentTrackingStoreInput extends PaymentTrackingAction {
  key: string;
  sourceIdentity: PaymentIdentity;
  actor: PaymentActor;
}

const eligibleRoles = ['ADMIN', 'ACCOUNTING'] as const;
const eventTypes = ['defer', 'reset', 'note', 'assign', 'priority', 'contact'];
const channels = ['email', 'whatsapp', 'phone'];
const ASSIGNEES_TTL_MS = 30_000;
const userSelect = {
  id: true,
  name: true,
  role: true,
  isActive: true,
} as const;
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

function invalid(message: string): never {
  throw new BadRequestException(message);
}

function conflict(): never {
  throw new ConflictException({
    code: 'PAYMENT_TRACKING_VERSION_CONFLICT',
    message: 'Takip kaydı değişti. Güncel kaydı yükleyip yeniden deneyin.',
  });
}

function keyValue(key: string): string {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
    invalid('Takip kaydı anahtarı geçersiz.');
  return key;
}

function dateValue(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid('Takip tarihi YYYY-MM-DD biçiminde olmalıdır.');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || day(result) !== value)
    invalid('Takip tarihi geçersiz.');
  return result;
}

/** Persist only stable source references, never names or financial snapshots. */
function identityValue(value: unknown): PaymentIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Kaynak kimliği geçersiz.');
  const input = value as Record<string, unknown>;
  const text = (name: string): string | null => {
    const value = input[name];
    if (value !== null && typeof value !== 'string')
      invalid('Kaynak kodu geçersiz.');
    return value;
  };
  return {
    customerCode: text('customerCode'),
    unitCode: text('unitCode'),
    currency: text('currency'),
  };
}

function state(row: PaymentTrackingCase): PaymentTrackingState {
  return {
    key: row.key,
    sourceIdentity: identityValue(row.sourceIdentity),
    trackingDate: day(row.trackingDate),
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    priority: row.priority as PaymentTrackingState['priority'],
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

function eventDto(row: PaymentTrackingEvent): PaymentTrackingEventDto {
  return {
    id: row.id,
    type: row.type as PaymentTrackingEventDto['type'],
    body: row.body ?? '',
    previousDate: day(row.beforeDate),
    nextDate: day(row.afterDate),
    actorName: row.actorName,
    channel: row.channel as PaymentTrackingEventDto['channel'],
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PaymentTrackingStoreService {
  private readonly db: PrismaClient;
  private cachedAssignees: {
    expiresAt: number;
    value: PaymentAssignee[];
  } | null = null;
  private loadingAssignees: Promise<PaymentAssignee[]> | null = null;

  constructor(prisma: PrismaService) {
    this.db = prisma as unknown as PrismaClient;
  }

  async getMany(keys?: string[]): Promise<PaymentTrackingState[]> {
    if (keys?.length === 0) return [];
    const rows = await this.db.paymentTrackingCase.findMany({
      where: keys ? { key: { in: [...new Set(keys.map(keyValue))] } } : {},
      orderBy: { key: 'asc' },
    });
    return rows.map(state);
  }

  async get(key: string): Promise<PaymentTrackingState | null> {
    const row = await this.db.paymentTrackingCase.findUnique({
      where: { key: keyValue(key) },
    });
    return row ? state(row) : null;
  }

  async history(key: string): Promise<{
    items: PaymentTrackingEventDto[];
    hasMore: boolean;
  }> {
    const rows = await this.db.paymentTrackingEvent.findMany({
      where: { caseKey: keyValue(key) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
    });
    return {
      items: rows.slice(0, 100).map(eventDto),
      hasMore: rows.length > 100,
    };
  }

  async assignables(forceFresh = false): Promise<PaymentAssignee[]> {
    if (
      !forceFresh &&
      this.cachedAssignees &&
      this.cachedAssignees.expiresAt > Date.now()
    )
      return structuredClone(this.cachedAssignees.value);
    if (!this.loadingAssignees) {
      const pending = this.db.user
        .findMany({
          where: { isActive: true, role: { in: [...eligibleRoles] } },
          select: { id: true, name: true, role: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        })
        .then(
          (rows) => {
            this.cachedAssignees = {
              value: structuredClone(rows),
              expiresAt: Date.now() + ASSIGNEES_TTL_MS,
            };
            return rows;
          },
          (error: unknown) => {
            // Never silently substitute the previous list after a forced failure.
            this.cachedAssignees = null;
            throw error;
          },
        )
        .finally(() => {
          if (this.loadingAssignees === pending) this.loadingAssignees = null;
        });
      this.loadingAssignees = pending;
    }
    return structuredClone(await this.loadingAssignees);
  }

  async apply(input: PaymentTrackingStoreInput): Promise<PaymentTrackingState> {
    const key = keyValue(input.key);
    const identity = identityValue(input.sourceIdentity);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      invalid('Takip kaydı sürümü geçersiz.');
    if (!eventTypes.includes(input.type)) invalid('Takip işlemi geçersiz.');
    if (typeof input.body !== 'string' || input.body.length > 2000)
      invalid('İşlem notu en fazla 2000 karakter olmalıdır.');
    const body = input.body.trim();
    if (['defer', 'note'].includes(input.type) && !body)
      invalid('Bu işlem için açıklama gereklidir.');
    const trackingDate =
      input.type === 'defer' ? dateValue(input.trackingDate) : null;
    if (
      input.type === 'assign' &&
      input.assigneeId !== null &&
      (typeof input.assigneeId !== 'string' || !input.assigneeId.trim())
    )
      invalid('Sorumlu seçimi geçersiz.');
    if (
      input.type === 'priority' &&
      input.priority !== 'normal' &&
      input.priority !== 'high'
    )
      invalid('Öncelik geçersiz.');
    if (
      input.type === 'contact' &&
      (!input.channel || !channels.includes(input.channel))
    )
      invalid('İletişim kanalı geçersiz.');
    if (
      !input.actor?.id ||
      !eligibleRoles.some((role) => role === input.actor.role)
    )
      throw new ForbiddenException(
        'Bu işlem için muhasebe yetkisi gereklidir.',
      );

    try {
      return await this.db.$transaction(async (tx) => {
        const actor = await tx.user.findUnique({
          where: { id: input.actor.id },
          select: userSelect,
        });
        if (
          !actor?.isActive ||
          !eligibleRoles.some((role) => role === actor.role)
        )
          throw new ForbiddenException('Aktif bir muhasebe hesabı gereklidir.');

        const current = await tx.paymentTrackingCase.findUnique({
          where: { key },
        });
        if ((current?.version ?? 0) !== input.expectedVersion) conflict();
        if (
          current &&
          JSON.stringify(identityValue(current.sourceIdentity)) !==
            JSON.stringify(identity)
        )
          conflict();

        const patch: Prisma.PaymentTrackingCaseUncheckedUpdateManyInput = {};
        let eventBody = body;
        if (input.type === 'defer' || input.type === 'reset')
          patch.trackingDate = trackingDate;
        if (input.type === 'assign') {
          const assignee = input.assigneeId
            ? await tx.user.findUnique({
                where: { id: input.assigneeId },
                select: userSelect,
              })
            : null;
          if (
            input.assigneeId &&
            (!assignee?.isActive ||
              !eligibleRoles.some((role) => role === assignee.role))
          )
            invalid(
              'Sorumlu, aktif bir yönetici veya muhasebe kullanıcısı olmalıdır.',
            );
          patch.assigneeId = assignee?.id ?? null;
          patch.assigneeName = assignee?.name ?? null;
          eventBody ||= `Sorumlu: ${current?.assigneeName ?? 'Atanmamış'} → ${assignee?.name ?? 'Atanmamış'}`;
        }
        if (input.type === 'priority') {
          patch.priority = input.priority;
          eventBody ||= `Öncelik: ${current?.priority ?? 'normal'} → ${input.priority}`;
        }

        if (current) {
          const changed = await tx.paymentTrackingCase.updateMany({
            where: { key, version: input.expectedVersion },
            data: {
              ...patch,
              version: { increment: 1 },
              updatedById: actor.id,
              updatedByName: actor.name,
            },
          });
          if (changed.count !== 1) conflict();
        } else {
          await tx.paymentTrackingCase.create({
            data: {
              key,
              sourceIdentity: { ...identity },
              trackingDate: input.type === 'defer' ? trackingDate : null,
              priority: input.type === 'priority' ? input.priority : 'normal',
              assigneeId:
                typeof patch.assigneeId === 'string' ? patch.assigneeId : null,
              assigneeName:
                typeof patch.assigneeName === 'string'
                  ? patch.assigneeName
                  : null,
              createdById: actor.id,
              createdByName: actor.name,
              updatedById: actor.id,
              updatedByName: actor.name,
            },
          });
        }
        await tx.paymentTrackingEvent.create({
          data: {
            caseKey: key,
            type: input.type,
            body: eventBody || null,
            beforeDate: ['defer', 'reset'].includes(input.type)
              ? (current?.trackingDate ?? null)
              : null,
            afterDate: ['defer', 'reset'].includes(input.type)
              ? trackingDate
              : null,
            actorId: actor.id,
            actorName: actor.name,
            channel: input.type === 'contact' ? input.channel : null,
          },
        });
        const updated = await tx.paymentTrackingCase.findUniqueOrThrow({
          where: { key },
        });
        return state(updated);
      });
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : null;
      // A competing first creation, stale update or serializable transaction abort.
      if (code === 'P2002' || code === 'P2025' || code === 'P2034') conflict();
      throw error;
    }
  }
}
