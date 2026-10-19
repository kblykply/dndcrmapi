import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import {
  paymentList,
  parsePaymentQuery,
  PaymentTrackingService,
} from './payment-tracking.service';
import { normalizeSalesCode, salesLedgerSnapshot } from './sales-ledger-scope';
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
    const [data, mappings] = await Promise.all([
      snapshot ? Promise.resolve(snapshot) : this.source.snapshot(),
      this.prisma.salesLedgerRepresentative.findMany({
        select: { code: true, userId: true },
      }),
    ]);
    // Only authenticated supervisors may view the full portfolio. Query parameters
    // never influence this access decision.
    return salesLedgerSnapshot(
      data,
      actor.role === 'SALES' ? actor.id : null,
      mappings,
    );
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
    return { ...result, assignees: [] };
  }
  async action(actor: PaymentActor, key: string, body: unknown) {
    const type = (body as { type?: string })?.type;
    if (!type || !['defer', 'reset', 'note', 'contact'].includes(type))
      throw new ForbiddenException(
        'Bu işlem satışçı carilerinde kullanılamaz.',
      );
    return this.payments
      .action(key, body, actor, (snapshot) => this.scoped(actor, snapshot))
      .then((result) => ({ ...result, assignees: [] }));
  }
  async mappings() {
    const [snapshot, users, mappings] = await Promise.all([
      this.source.snapshot(),
      this.prisma.user.findMany({
        where: { role: 'SALES', isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.salesLedgerRepresentative.findMany(),
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
      const scoped = salesLedgerSnapshot(snapshot, user.id, mappings);
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
