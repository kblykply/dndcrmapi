import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertConstructionAccess,
  type ConstructionUser,
} from './construction.guard';
import {
  budgetTotals,
  claimTotals,
  decimal,
  money,
  progressTotals,
} from './construction.math';
import {
  choice,
  day,
  numeric,
  object,
  text,
  version,
} from './construction.validation';
type Tx = Prisma.TransactionClient;
const sourceSelect = {
  id: true,
  kind: true,
  fileName: true,
  sha256: true,
  sourceDate: true,
  dateBasis: true,
  importedAt: true,
};
const entrySummary = {
  status: true,
  quality: true,
  trade: { select: { weight: true } },
};
const conflict = () => {
  throw new ConflictException(
    'Kayıt başka bir işlemle değişti. Yenileyip tekrar deneyin.',
  );
};
@Injectable()
export class ConstructionService {
  private readonly db: PrismaClient;
  constructor(prisma: PrismaService) {
    this.db = prisma as unknown as PrismaClient;
  }
  private async actor(user: ConstructionUser, tx: Tx) {
    assertConstructionAccess(user, true);
    const actor = await tx.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    assertConstructionAccess(actor?.isActive ? actor : undefined, true);
    return actor!;
  }
  private async audit(
    tx: Tx,
    user: ConstructionUser,
    projectId: string,
    entityType: string,
    entityId: string,
    reason: string,
    before: unknown,
    after: unknown,
  ) {
    const actor = await this.actor(user, tx);
    await tx.constructionActivity.create({
      data: {
        projectId,
        entityType,
        entityId,
        actorId: actor.id,
        actorName: actor.name,
        reason,
        before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      },
    });
  }
  private summarizeUnits<
    T extends { entries: Parameters<typeof progressTotals>[0] },
  >(units: T[]) {
    return units.map(({ entries, ...u }) => ({
      ...u,
      ...progressTotals(entries),
    }));
  }
  async workspace(user: ConstructionUser) {
    assertConstructionAccess(user);
    const projects = await this.db.constructionProject.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        units: {
          select: { included: true, entries: { select: entrySummary } },
        },
        claims: {
          include: {
            lines: {
              select: { acceptedQty: true, previousQty: true, unitPrice: true },
            },
          },
        },
        budgets: { include: { items: true } },
        _count: { select: { issues: { where: { status: 'OPEN' } } } },
      },
    });
    return {
      canEdit: user.role === 'ADMIN',
      projects: projects.map(({ units, claims, budgets, _count, ...p }) => {
        const included = units.filter((u) => u.included);
        const latest = [...claims].sort(
          (a, b) => b.period.getTime() - a.period.getTime(),
        )[0];
        return {
          ...p,
          unitCount: units.length,
          includedCount: included.length,
          progress: included.length
            ? included.reduce(
                (n, u) => n + (progressTotals(u.entries).progress ?? 0),
                0,
              ) / included.length
            : null,
          claimCount: claims.length,
          latestClaim: latest
            ? { number: latest.number, ...claimTotals(latest) }
            : null,
          budgets: budgets.map(({ items, ...b }) => ({
            ...b,
            ...budgetTotals(items),
          })),
          openIssues: _count.issues,
        };
      }),
    };
  }
  async project(id: string, user: ConstructionUser) {
    assertConstructionAccess(user);
    const p = await this.db.constructionProject.findUnique({
      where: { id },
      include: {
        sources: { select: sourceSelect },
        trades: { orderBy: { position: 'asc' } },
        units: {
          orderBy: [{ block: 'asc' }, { position: 'asc' }],
          include: { entries: { select: entrySummary } },
        },
        claims: {
          orderBy: { period: 'desc' },
          include: {
            lines: {
              select: { acceptedQty: true, previousQty: true, unitPrice: true },
            },
          },
        },
        budgets: { include: { items: true } },
        issues: { orderBy: [{ severity: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!p) throw new NotFoundException();
    const { units, claims, budgets, ...project } = p;
    const rows = this.summarizeUnits(units);
    const blocks = [...new Set(rows.map((u) => u.block))].map((block) => {
      const all = rows.filter((u) => u.block === block);
      const scoped = all.filter((u) => u.included);
      return {
        block,
        total: all.length,
        included: scoped.length,
        progress: scoped.length
          ? scoped.reduce((n, u) => n + (u.progress ?? 0), 0) / scoped.length
          : null,
        completed: scoped.filter((u) => u.progress === 100).length,
        checked: all.reduce((n, u) => n + u.checked, 0),
        defects: all.reduce((n, u) => n + u.defects, 0),
      };
    });
    return {
      ...project,
      units: rows,
      blocks,
      claims: claims.map(({ lines, ...c }) => ({
        ...c,
        ...claimTotals({ ...c, lines }),
      })),
      budgets: budgets.map(({ items, ...b }) => ({
        ...b,
        ...budgetTotals(items),
      })),
      canEdit: user.role === 'ADMIN',
    };
  }
  async unit(id: string, user: ConstructionUser) {
    assertConstructionAccess(user);
    const unit = await this.db.constructionUnit.findUnique({
      where: { id },
      include: {
        project: true,
        entries: {
          include: { trade: true },
          orderBy: { trade: { position: 'asc' } },
        },
      },
    });
    if (!unit) throw new NotFoundException();
    return {
      ...unit,
      ...progressTotals(unit.entries),
      canEdit: user.role === 'ADMIN',
    };
  }
  async claim(id: string, user: ConstructionUser) {
    assertConstructionAccess(user);
    const claim = await this.db.constructionClaim.findUnique({
      where: { id },
      include: { project: true, lines: { orderBy: { position: 'asc' } } },
    });
    if (!claim) throw new NotFoundException();
    const newer = await this.db.constructionClaim.findFirst({
      where: {
        projectId: claim.projectId,
        contractor: claim.contractor,
        period: { gt: claim.period },
      },
      select: { id: true },
    });
    return {
      ...claim,
      totals: claimTotals(claim),
      canEdit: user.role === 'ADMIN' && !newer,
      lockedByNextPeriod: !!newer,
    };
  }
  async budget(id: string, user: ConstructionUser) {
    assertConstructionAccess(user);
    const b = await this.db.constructionBudget.findUnique({
      where: { id },
      include: { project: true, items: { orderBy: { position: 'asc' } } },
    });
    if (!b) throw new NotFoundException();
    return {
      ...b,
      totals: budgetTotals(b.items),
      items: b.items.map((i) => ({
        ...i,
        calculated: money(decimal(i.quantity).times(i.unitPrice)),
        remainingQty:
          i.completedQty === null
            ? null
            : decimal(i.quantity).minus(i.completedQty).toNumber(),
        remainingBalance:
          i.paid === null
            ? null
            : money(decimal(i.quantity).times(i.unitPrice).minus(i.paid)),
      })),
      canEdit: user.role === 'ADMIN',
    };
  }
  async history(
    projectId: string,
    user: ConstructionUser,
    cursor?: string,
    entityId?: string,
  ) {
    assertConstructionAccess(user);
    const project = await this.db.constructionProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
    if (cursor) {
      const found = await this.db.constructionActivity.findFirst({
        where: { id: cursor, projectId, ...(entityId ? { entityId } : {}) },
        select: { id: true },
      });
      if (!found) throw new NotFoundException();
    }
    const rows = await this.db.constructionActivity.findMany({
      where: { projectId, ...(entityId ? { entityId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, 50),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  async updateEntry(
    unitId: string,
    id: string,
    body: unknown,
    user: ConstructionUser,
  ) {
    const b = object(body);
    const v = version(b.version),
      reason = text(b.reason, 1000, 3);
    const data = {
      status: choice(b.status, ['DONE', 'NOT_DONE', 'PARTIAL']),
      quality: choice(b.quality, [
        'UNCHECKED',
        'SUITABLE',
        'PARTIAL',
        'UNSUITABLE',
      ]),
      note: text(b.note),
    };
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const old = await tx.constructionProgress.findFirst({
        where: { id, unitId },
        include: { unit: { select: { projectId: true } } },
      });
      if (!old) throw new NotFoundException();
      if (old.version !== v) conflict();
      const changed = await tx.constructionProgress.updateMany({
        where: { id, version: v },
        data: {
          ...data,
          checkedAt:
            old.quality !== data.quality
              ? data.quality === 'UNCHECKED'
                ? null
                : new Date()
              : old.checkedAt,
          version: { increment: 1 },
        },
      });
      if (!changed.count) conflict();
      await this.audit(
        tx,
        user,
        old.unit.projectId,
        'PROGRESS',
        unitId,
        reason,
        { id, status: old.status, quality: old.quality, note: old.note },
        { id, ...data },
      );
      return { ok: true };
    });
  }
  async updateBudgetItem(
    budgetId: string,
    id: string,
    body: unknown,
    user: ConstructionUser,
  ) {
    const b = object(body);
    const v = version(b.version),
      reason = text(b.reason, 1000, 3);
    const data = {
      quantity: numeric(b.quantity)!,
      unitPrice: numeric(b.unitPrice, { scale: 8 })!,
      completedQty: numeric(b.completedQty, { nullable: true }),
      paid: numeric(b.paid, { nullable: true }),
      note: text(b.note),
    };
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const old = await tx.constructionBudgetItem.findFirst({
        where: { id, budgetId },
        include: { budget: { select: { projectId: true } } },
      });
      if (!old) throw new NotFoundException();
      if (old.version !== v) conflict();
      const changed = await tx.constructionBudgetItem.updateMany({
        where: { id, version: v },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      const { budget, ...before } = old;
      await this.audit(
        tx,
        user,
        budget.projectId,
        'BUDGET',
        budgetId,
        reason,
        before,
        { id, ...data },
      );
      return { ok: true };
    });
  }
  private async assertLatestClaim(
    tx: Tx,
    claim: { projectId: string; contractor: string; period: Date },
  ) {
    const newer = await tx.constructionClaim.findFirst({
      where: {
        projectId: claim.projectId,
        contractor: claim.contractor,
        period: { gt: claim.period },
      },
      select: { id: true },
    });
    if (newer)
      throw new ConflictException(
        'Bu hakedişten sonraki dönem açılmış. Devir miktarlarını korumak için önceki dönem düzenlemeye kapalıdır.',
      );
  }
  async updateClaimLine(
    claimId: string,
    id: string,
    body: unknown,
    user: ConstructionUser,
  ) {
    const b = object(body);
    const v = version(b.version),
      reason = text(b.reason, 1000, 3);
    const data = {
      previousQty: numeric(b.previousQty)!,
      measuredQty: numeric(b.measuredQty, { nullable: true }),
      acceptedQty: numeric(b.acceptedQty)!,
      unitPrice: numeric(b.unitPrice, { scale: 8 })!,
      note: text(b.note),
    };
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const old = await tx.constructionClaimLine.findFirst({
        where: { id, claimId },
        include: {
          claim: {
            select: {
              projectId: true,
              version: true,
              contractor: true,
              period: true,
            },
          },
        },
      });
      if (!old) throw new NotFoundException();
      if (old.claim.version !== v) conflict();
      await this.assertLatestClaim(tx, old.claim);
      const changed = await tx.constructionClaim.updateMany({
        where: { id: claimId, version: v },
        data: { version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      await tx.constructionClaimLine.update({ where: { id }, data });
      const before = {
        id: old.id,
        previousQty: old.previousQty,
        measuredQty: old.measuredQty,
        acceptedQty: old.acceptedQty,
        unitPrice: old.unitPrice,
        note: old.note,
      };
      await this.audit(
        tx,
        user,
        old.claim.projectId,
        'CLAIM',
        claimId,
        reason,
        before,
        { id, ...data },
      );
      return { ok: true };
    });
  }
  async updateClaim(id: string, body: unknown, user: ConstructionUser) {
    const b = object(body);
    const v = version(b.version),
      reason = text(b.reason, 1000, 3);
    const data = {
      taxRate: numeric(b.taxRate, { max: 100, scale: 4 })!,
      adjustment: numeric(b.adjustment, { signed: true })!,
      deduction: numeric(b.deduction)!,
      adjustmentNote: text(b.adjustmentNote, 2000, 3),
      note: text(b.note),
    };
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const old = await tx.constructionClaim.findUnique({ where: { id } });
      if (!old) throw new NotFoundException();
      await this.assertLatestClaim(tx, old);
      const changed = await tx.constructionClaim.updateMany({
        where: { id, version: v },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      await this.audit(tx, user, old.projectId, 'CLAIM', id, reason, old, data);
      return { ok: true };
    });
  }
  async createClaim(baseId: string, body: unknown, user: ConstructionUser) {
    const b = object(body);
    const expected = version(b.version),
      number = text(b.number, 40, 1),
      period = day(b.period),
      reason = text(b.reason, 1000, 3);
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const base = await tx.constructionClaim.findUnique({
        where: { id: baseId },
        include: { lines: true },
      });
      if (!base) throw new NotFoundException();
      if (base.version !== expected) conflict();
      if (period <= base.period)
        throw new ConflictException(
          'Yeni dönem önceki hakedişten sonra olmalı.',
        );
      const newer = await tx.constructionClaim.findFirst({
        where: {
          projectId: base.projectId,
          contractor: base.contractor,
          period: { gt: base.period },
        },
      });
      if (newer)
        throw new ConflictException(
          'En son hakediş üzerinden yeni dönem açın.',
        );
      const duplicate = await tx.constructionClaim.findFirst({
        where: {
          projectId: base.projectId,
          contractor: base.contractor,
          number,
        },
      });
      if (duplicate)
        throw new ConflictException('Bu hakediş numarası zaten var.');
      const changed = await tx.constructionClaim.updateMany({
        where: { id: baseId, version: expected },
        data: { version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      const result = await tx.constructionClaim.create({
        data: {
          projectId: base.projectId,
          contractor: base.contractor,
          number,
          period,
          currency: base.currency,
          taxRate: base.taxRate,
          adjustment: 0,
          deduction: 0,
          note: 'Yeni dönem taslağı; miktarlar ve fiyatlar kontrol edilmeli.',
          lines: {
            create: base.lines.map((l) => ({
              position: l.position,
              code: l.code,
              name: l.name,
              unit: l.unit,
              previousQty: decimal(l.previousQty).plus(l.acceptedQty),
              acceptedQty: 0,
              unitPrice: l.unitPrice,
              measurements: { name: 'Yeni dönem', cells: [] },
            })),
          },
        },
      });
      await this.audit(
        tx,
        user,
        base.projectId,
        'CLAIM',
        result.id,
        reason,
        { baseId },
        { number, period: period.toISOString() },
      );
      return { id: result.id };
    });
  }
  async updateIssue(id: string, body: unknown, user: ConstructionUser) {
    const b = object(body);
    const v = version(b.version),
      status = choice(b.status, ['OPEN', 'RESOLVED']),
      resolution = text(b.resolution, 4000, status === 'RESOLVED' ? 10 : 0);
    const reason = text(b.reason, 1000, 3);
    return this.db.$transaction(async (tx) => {
      await this.actor(user, tx);
      const old = await tx.constructionIssue.findUnique({ where: { id } });
      if (!old) throw new NotFoundException();
      const changed = await tx.constructionIssue.updateMany({
        where: { id, version: v },
        data: { status, resolution, version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      await this.audit(
        tx,
        user,
        old.projectId,
        'ISSUE',
        id,
        reason,
        { status: old.status, resolution: old.resolution },
        { status, resolution },
      );
      return { ok: true };
    });
  }
}
