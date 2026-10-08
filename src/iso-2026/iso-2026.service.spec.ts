import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Iso2026Service } from './iso-2026.service';
import { Iso2026Source } from './iso-2026.catalog';
import type { IsoClause, IsoSourceData } from './iso-2026.catalog';
import { PrismaService } from '../prisma/prisma.service';

const admin = { id: 'admin', role: 'ADMIN', email: 'admin@example.test' };
const preview = { ...admin, role: 'PREVIEW' };
const at = new Date('2026-09-25T10:00:00.000Z');
function clause(code: string, parentCode: string | null = null): IsoClause {
  return { code, title: `Source ${code}`, titleTr: `Başlık ${code}`, parentCode, kind: 'CLAUSE', body: `Immutable source ${code}`, sourcePages: [1], relatedCodes: [] };
}
const catalog: IsoSourceData = {
  document: { title: 'ISO', reference: 'ISO 9001:2026', status: 'DRAFT', language: 'en', sourceFile: 'ISO.pdf', totalPages: 1, sha256: 'test' },
  clauses: [clause('4'), clause('4.1', '4'), clause('4.2', '4')],
};
function fixture() {
  let state = { cards: [] as any[], checklists: [] as any[], documents: [] as any[], logs: [] as any[], audits: [] as any[] };
  let sequence = 0;
  const source = {
    data: () => structuredClone(catalog),
    clause: (code: string) => {
      const row = catalog.clauses.find((item) => item.code === code);
      if (!row) throw new NotFoundException();
      return structuredClone(row);
    },
  };
  const hydrate = (card: any) => card && ({ ...card,
    checklists: state.checklists.filter((row) => row.cardId === card.id),
    documents: state.documents.filter((row) => row.cardId === card.id),
    logs: state.logs.filter((row) => row.cardId === card.id),
    _count: { logs: state.logs.filter((row) => row.cardId === card.id).length },
  });
  const table = (name: 'checklists' | 'documents' | 'logs' | 'audits') => ({
    create: jest.fn(async ({ data }) => {
      const row = { id: `${name}-${++sequence}`, createdAt: at, updatedAt: at,
        ...(name === 'checklists' ? { isChecked: false, required: false, sortOrder: 0 } : {}),
        ...(name === 'documents' ? { type: 'PROCEDURE', status: 'ACTIVE' } : {}), ...data };
      state[name].push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where }) => state[name].find((row) => row.id === where.id && row.cardId === where.cardId) || null),
    update: jest.fn(async ({ where, data }) => {
      const row = state[name].find((item) => item.id === where.id);
      Object.assign(row, data);
      return { ...row };
    }),
    delete: jest.fn(async ({ where }) => {
      const index = state[name].findIndex((item) => item.id === where.id);
      return state[name].splice(index, 1)[0];
    }),
  });
  const db = {
    iso2026Card: {
      findMany: jest.fn(async ({ where }) => state.cards.filter((row) => where.code.in.includes(row.code)).map(hydrate)),
      findUnique: jest.fn(async ({ where }) => hydrate(state.cards.find((row) => where.code ? row.code === where.code : row.id === where.id)) || null),
      upsert: jest.fn(async ({ where, create }) => {
        let row = state.cards.find((item) => item.code === where.code);
        if (!row) { row = { id: `card-${++sequence}`, createdAt: at, updatedAt: at, ...create }; state.cards.push(row); }
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = state.cards.find((item) => item.id === where.id);
        Object.assign(row, data);
        return hydrate(row);
      }),
    },
    iso2026ChecklistItem: table('checklists'), iso2026Document: table('documents'), iso2026Log: table('logs'), auditLog: table('audits'),
    $transaction: jest.fn(async (operation) => {
      const before = structuredClone(state);
      try { return await operation(db); } catch (error) { state = before; throw error; }
    }),
  };
  for (const old of ['qualityProcessCard', 'qualityChecklistItem', 'qualityDocument', 'qualityProcessLog']) {
    Object.defineProperty(db, old, { get: () => { throw new Error('Legacy quality data accessed'); } });
  }
  const service = new Iso2026Service(db as unknown as PrismaService, source as Iso2026Source);
  return { service, db, source, state: () => state };
}

describe('ISO 2026 isolated persistent workspace', () => {
  it('returns virtual list/detail without writes, navigates source hierarchy and keeps source immutable', async () => {
    const { service, db } = fixture();
    const list = await service.list(preview);
    expect(list.items).toHaveLength(3);
    expect(list.items[0]).toMatchObject({ id: '4', code: '4', description: null, completion: 0 });
    expect(list.clauses[0]).not.toHaveProperty('body');
    const detail = await service.get(preview, '4.1');
    expect(detail.clause.body).toBe('Immutable source 4.1');
    expect(detail.ancestors.map((row) => row.code)).toEqual(['4']);
    expect(detail.previous?.code).toBe('4');
    expect(detail.next?.code).toBe('4.2');
    expect(detail.item).toMatchObject({ checklists: [], documents: [], logs: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.iso2026Card.upsert).not.toHaveBeenCalled();
    expect((await service.get(admin, '4')).children.map((row) => row.code)).toEqual(['4.1', '4.2']);
  });

  it('creates only the requested card on first mutation and preserves edits on later child writes', async () => {
    const { service, state } = fixture();
    await service.updateCard(admin, '4.1', { title: 'My title', description: 'Our notes', status: 'NEEDS_REVIEW', ownerDepartment: 'Quality' });
    await service.createChecklist(admin, '4.1', { title: 'Verify record', required: true });
    await service.createDocument(admin, '4.1', { title: 'Evidence', url: 'https://example.test/report.pdf' });
    expect(state().cards).toHaveLength(1);
    expect(state().cards[0]).toMatchObject({ code: '4.1', title: 'My title', description: 'Our notes' });
    const detail = await service.get(admin, '4.1');
    expect(detail.clause.body).toBe('Immutable source 4.1');
    expect(detail.item).toMatchObject({ documentsTotal: 1, checklistTotal: 1, requiredTotal: 1, logsTotal: 3 });
    expect((await service.list(admin)).totals).toMatchObject({ cards: 3, cardsNeedReview: 1, checklistTotal: 1, documents: 1 });
    expect(state().audits.every((row) => row.entityType === 'Iso2026Card')).toBe(true);
  });

  it.each(['PREVIEW', 'CALLCENTER', 'ACCOUNTING'])('rejects %s mutations before any data access', async (role) => {
    const { service, db } = fixture();
    await expect(service.updateCard({ ...admin, role }, '4.1', { title: 'new' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.addLog({ ...admin, role }, '4.1', { note: 'note' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MANAGER', 'SALES', 'AFTERSALES'])('permits %s to edit', async (role) => {
    const { service } = fixture();
    await expect(service.updateCard({ ...admin, role }, '4.1', { status: 'ACTIVE' })).resolves.toMatchObject({ code: '4.1' });
  });

  it('rejects unauthenticated and excluded readers, including source PDF', async () => {
    const { service, db } = fixture();
    await expect(service.list(null as any)).rejects.toBeInstanceOf(UnauthorizedException);
    for (const role of ['CALLCENTER', 'ACCOUNTING']) {
      await expect(service.get({ ...admin, role }, '4')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.sourcePdf({ ...admin, role })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(db.iso2026Card.findUnique).not.toHaveBeenCalled();
  });

  it('does not accept arbitrary or legacy card codes', async () => {
    const { service, db } = fixture();
    await expect(service.get(admin, 'qc-4-1-context')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createChecklist(admin, 'missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.iso2026Card.upsert).not.toHaveBeenCalled();
  });

  it.each([{ code: '5' }, { body: 'replace PDF' }, { status: 'INVALID' }, { category: 'INVALID' }, { title: '' }, { sortOrder: 1.5 }, { color: 'red' }, {}])('validates card edits before lazy creation: %j', async (body) => {
    const { service, db } = fixture();
    await expect(service.updateCard(admin, '4.1', body)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', '2026-13-01', 'not a date', 5])('rejects invalid checklist dates: %s', async (dueAt) => {
    const { service, db } = fixture();
    await expect(service.createChecklist(admin, '4.1', { title: 'task', dueAt })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('tracks check/uncheck actor and time and does not resurrect deleted checklist entries on reads', async () => {
    const { service } = fixture();
    const item = await service.createChecklist(admin, '4.1', { title: 'task', dueAt: '2028-02-29', required: true });
    const done = await service.updateChecklist(admin, '4.1', item.id, { isChecked: true });
    expect(done.checkedById).toBe('admin');
    expect(done.checkedAt).toBeInstanceOf(Date);
    expect((await service.get(admin, '4.1')).item.completion).toBe(100);
    const undone = await service.updateChecklist(admin, '4.1', item.id, { isChecked: false });
    expect(undone).toMatchObject({ checkedById: null, checkedAt: null });
    await service.deleteChecklist(admin, '4.1', item.id);
    expect((await service.get(admin, '4.1')).item.checklists).toEqual([]);
  });

  it.each(['2026-09-24T22:00:00.000Z', '2026-09-25T10:00:00.000Z'])('uses the Cyprus calendar day for overdue totals at %s', async (now) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    try {
      const { service } = fixture();
      await service.createChecklist(admin, '4.1', { title: 'Yesterday', dueAt: '2026-09-24' });
      await service.createChecklist(admin, '4.1', { title: 'Today', dueAt: '2026-09-25' });
      await service.createChecklist(admin, '4.1', { title: 'Tomorrow', dueAt: '2026-09-26' });
      await service.createChecklist(admin, '4.1', { title: 'Already checked', dueAt: '2026-09-23', isChecked: true });
      expect((await service.get(admin, '4.1')).item.overdueChecklist).toBe(1);
      expect((await service.list(admin)).totals.overdueChecklist).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['javascript:alert(1)', 'data:text/html,example', '//example.test/x', 'https://user:password@example.test/x'])('rejects unsafe document URL: %s', async (url) => {
    const { service, db } = fixture();
    await expect(service.createDocument(admin, '4.1', { title: 'doc', url })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects document enum values, nonboolean checklist values and empty notes', async () => {
    const { service } = fixture();
    await expect(service.createDocument(admin, '4', { title: 'doc', status: 'PUBLISHED' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createDocument(admin, '4', { title: 'doc', type: 'HTML' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createChecklist(admin, '4', { title: 'task', isChecked: 'false' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addLog(admin, '4', { note: ' ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes child edits and deletes to their clause, preventing cross-card and old module IDs', async () => {
    const { service, state } = fixture();
    const checklist = await service.createChecklist(admin, '4.1', { title: 'A' });
    const doc = await service.createDocument(admin, '4.1', { title: 'A' });
    await service.updateCard(admin, '4.2', { title: 'B' });
    await expect(service.updateChecklist(admin, '4.2', checklist.id, { title: 'tamper' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteChecklist(admin, '4.2', checklist.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateDocument(admin, '4.2', doc.id, { title: 'tamper' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteDocument(admin, '4.2', doc.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(state().checklists[0].title).toBe('A');
    expect(state().documents[0].title).toBe('A');
  });

  it('persists document edits and notes and rolls back all mutations if audit logging fails', async () => {
    const { service, db, state } = fixture();
    const doc = await service.createDocument(admin, '4.1', { title: 'draft', type: 'REPORT' });
    await service.updateDocument(admin, '4.1', doc.id, { title: 'final', status: 'ACTIVE', revision: '2', notes: 'reviewed' });
    const note = await service.addLog(admin, '4.1', { note: 'Team decision' });
    expect(note.note).toBe('Team decision');
    expect(state().documents[0]).toMatchObject({ title: 'final', revision: '2', notes: 'reviewed' });
    await service.deleteDocument(admin, '4.1', doc.id);
    expect(state().documents).toHaveLength(0);
    db.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.createChecklist(admin, '4.2', { title: 'rollback' })).rejects.toThrow('audit unavailable');
    expect(state().cards.map((card) => card.code)).toEqual(['4.1']);
    expect(state().checklists).toHaveLength(0);
  });
});

