import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { Iso2026Source, clauseMetadata } from './iso-2026.catalog';
import type { IsoClause } from './iso-2026.catalog';
import { ISO_READ_ROLES, ISO_WRITE_ROLES, cardInput, checklistInput, documentInput, objectBody, textField } from './iso-2026.dto';
import type { Input, IsoUser } from './iso-2026.dto';

const businessDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Famagusta', year: 'numeric', month: '2-digit', day: '2-digit',
});
const actor = { select: { id: true, name: true, email: true, role: true } };
const checklistInclude = { createdBy: actor, checkedBy: actor };
const documentInclude = { createdBy: actor, updatedBy: actor };
const detailInclude = {
  createdBy: actor, updatedBy: actor,
  checklists: { include: checklistInclude, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
  documents: { include: documentInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] },
  logs: { include: { createdBy: actor }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 80 },
  _count: { select: { logs: true } },
};
const listInclude = {
  checklists: { select: { id: true, isChecked: true, required: true, dueAt: true } },
  documents: { select: { id: true, status: true } },
  _count: { select: { logs: true } },
};

@Injectable()
export class Iso2026Service {
  constructor(private readonly prisma: PrismaService, private readonly source: Iso2026Source) {}

  private authorize(user: IsoUser, write = false) {
    if (!user?.id) throw new UnauthorizedException('Authentication required');
    const allowed: readonly string[] = write ? ISO_WRITE_ROLES : ISO_READ_ROLES;
    if (!allowed.includes(user.role)) throw new ForbiddenException(write ? 'No permission to edit ISO 2026' : 'No access to ISO 2026');
  }

  private defaults(clause: IsoClause) {
    const categories: Record<string, string> = { '4': 'CONTEXT', '5': 'LEADERSHIP', '6': 'PLANNING', '7': 'SUPPORT', '8': 'OPERATIONAL', '9': 'PERFORMANCE', '10': 'IMPROVEMENT' };
    return {
      code: clause.code, title: clause.titleTr || clause.title, description: null,
      category: categories[clause.code.split('.')[0]] || 'OPERATIONAL', status: 'ACTIVE',
      ownerDepartment: null, color: null,
      sortOrder: this.source.data().clauses.findIndex((row) => row.code === clause.code) * 10,
    };
  }

  private virtualCard(clause: IsoClause) {
    return {
      id: clause.code, ...this.defaults(clause), createdAt: null, updatedAt: null,
      createdById: null, updatedById: null, createdBy: null, updatedBy: null,
      checklists: [], documents: [], logs: [], _count: { logs: 0 },
    };
  }

  private summarize(card: any, detail = false) {
    const { _count, checklists = [], documents = [], logs = [], ...fields } = card;
    const checked = checklists.filter((item: any) => item.isChecked).length;
    const today = businessDayFormatter.format(new Date());
    const summary = {
      ...fields,
      checklistTotal: checklists.length, checklistDone: checked,
      requiredTotal: checklists.filter((item: any) => item.required).length,
      requiredDone: checklists.filter((item: any) => item.required && item.isChecked).length,
      documentsTotal: documents.length,
      documentsNeedReview: documents.filter((item: any) => item.status === 'NEEDS_REVIEW').length,
      overdueChecklist: checklists.filter((item: any) =>
        !item.isChecked && item.dueAt && new Date(item.dueAt).toISOString().slice(0, 10) < today,
      ).length,
      logsTotal: _count?.logs ?? logs.length,
      completion: checklists.length ? Math.round(checked / checklists.length * 100) : 0,
    };
    return detail ? { ...summary, checklists, documents, logs } : summary;
  }

  async list(user: IsoUser) {
    this.authorize(user);
    const { document, clauses } = this.source.data();
    const rows = await this.prisma.iso2026Card.findMany({ where: { code: { in: clauses.map((clause) => clause.code) } }, include: listInclude });
    const byCode = new Map(rows.map((row: any) => [row.code, row]));
    const items = clauses.map((clause) => this.summarize(byCode.get(clause.code) || this.virtualCard(clause)));
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'en', { numeric: true }));
    const totals = items.reduce((sum, item) => ({
      cards: sum.cards + 1,
      cardsNeedReview: sum.cardsNeedReview + Number(item.status === 'NEEDS_REVIEW'),
      checklistTotal: sum.checklistTotal + item.checklistTotal,
      checklistDone: sum.checklistDone + item.checklistDone,
      documents: sum.documents + item.documentsTotal,
      documentsNeedReview: sum.documentsNeedReview + item.documentsNeedReview,
      overdueChecklist: sum.overdueChecklist + item.overdueChecklist,
    }), { cards: 0, cardsNeedReview: 0, checklistTotal: 0, checklistDone: 0, documents: 0, documentsNeedReview: 0, overdueChecklist: 0 });
    return { document, clauses: clauses.map(clauseMetadata), items, totals: { ...totals, completion: totals.checklistTotal ? Math.round(totals.checklistDone / totals.checklistTotal * 100) : 0 } };
  }

  async get(user: IsoUser, code: string) {
    this.authorize(user);
    const clause = this.source.clause(code);
    const { document, clauses } = this.source.data();
    const index = clauses.findIndex((row) => row.code === code);
    const ancestors: ReturnType<typeof clauseMetadata>[] = [];
    const visited = new Set([code]);
    let parentCode = clause.parentCode;
    while (parentCode && !visited.has(parentCode)) {
      visited.add(parentCode);
      const parent = clauses.find((row) => row.code === parentCode);
      if (!parent) break;
      ancestors.unshift(clauseMetadata(parent));
      parentCode = parent.parentCode;
    }
    const row = await this.prisma.iso2026Card.findUnique({ where: { code }, include: detailInclude });
    return {
      document, clause,
      children: clauses.filter((row) => row.parentCode === code).map(clauseMetadata), ancestors,
      previous: index > 0 ? clauseMetadata(clauses[index - 1]) : null,
      next: index < clauses.length - 1 ? clauseMetadata(clauses[index + 1]) : null,
      item: this.summarize(row || this.virtualCard(clause), true),
    };
  }

  async sourcePdf(user: IsoUser) {
    this.authorize(user);
    try {
      return await readFile(join(process.cwd(), 'project-documents', 'iso-2026', 'ISO_9001_2026.pdf'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('ISO 2026 source PDF is not installed');
      throw error;
    }
  }

  private async ensureCard(tx: any, clause: IsoClause, user: IsoUser) {
    return tx.iso2026Card.upsert({
      where: { code: clause.code }, update: {},
      create: { ...this.defaults(clause), createdById: user.id, updatedById: user.id },
    });
  }

  private async existingCard(tx: any, code: string) {
    const card = await tx.iso2026Card.findUnique({ where: { code } });
    if (!card) throw new NotFoundException('ISO 2026 working record not found');
    return card;
  }

  private async log(tx: any, user: IsoUser, cardId: string, action: string, note: string | null, metaJson: Record<string, unknown>) {
    const row = await tx.iso2026Log.create({
      data: { cardId, createdById: user.id, action, note, metaJson }, include: { createdBy: actor },
    });
    await tx.auditLog.create({ data: { actorId: user.id, action, entityType: 'Iso2026Card', entityId: cardId, metaJson } });
    return row;
  }

  private requireChanges(data: Input) {
    if (!Object.keys(data).length) throw new BadRequestException('At least one editable field is required');
  }

  async updateCard(user: IsoUser, code: string, body: unknown) {
    this.authorize(user, true);
    const clause = this.source.clause(code);
    const data = cardInput(body);
    this.requireChanges(data);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.ensureCard(tx, clause, user);
      await tx.iso2026Card.update({ where: { id: card.id }, data: { ...data, updatedById: user.id } });
      await this.log(tx, user, card.id, 'ISO2026_CARD_UPDATE', 'Working record updated', { code, fields: Object.keys(data) });
      const updated = await tx.iso2026Card.findUnique({ where: { id: card.id }, include: detailInclude });
      return this.summarize(updated, true);
    });
  }

  async createChecklist(user: IsoUser, code: string, body: unknown) {
    this.authorize(user, true);
    const clause = this.source.clause(code);
    const data = checklistInput(body, true);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.ensureCard(tx, clause, user);
      const item = await tx.iso2026ChecklistItem.create({
        data: { ...data, cardId: card.id, createdById: user.id, checkedAt: data.isChecked ? new Date() : null, checkedById: data.isChecked ? user.id : null },
        include: checklistInclude,
      });
      await this.log(tx, user, card.id, 'ISO2026_CHECKLIST_CREATE', 'Checklist item added', { checklistItemId: item.id, title: item.title });
      return item;
    });
  }

  async updateChecklist(user: IsoUser, code: string, itemId: string, body: unknown) {
    this.authorize(user, true);
    this.source.clause(code);
    const data = checklistInput(body, false);
    this.requireChanges(data);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.existingCard(tx, code);
      const existing = await tx.iso2026ChecklistItem.findFirst({ where: { id: itemId, cardId: card.id } });
      if (!existing) throw new NotFoundException('Checklist item not found');
      if ('isChecked' in data && data.isChecked !== existing.isChecked) {
        data.checkedAt = data.isChecked ? new Date() : null;
        data.checkedById = data.isChecked ? user.id : null;
      }
      const item = await tx.iso2026ChecklistItem.update({ where: { id: itemId }, data, include: checklistInclude });
      await this.log(tx, user, card.id, 'ISO2026_CHECKLIST_UPDATE', 'Checklist item updated', { checklistItemId: item.id, fields: Object.keys(data) });
      return item;
    });
  }

  async deleteChecklist(user: IsoUser, code: string, itemId: string) {
    this.authorize(user, true);
    this.source.clause(code);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.existingCard(tx, code);
      const existing = await tx.iso2026ChecklistItem.findFirst({ where: { id: itemId, cardId: card.id } });
      if (!existing) throw new NotFoundException('Checklist item not found');
      await tx.iso2026ChecklistItem.delete({ where: { id: itemId } });
      await this.log(tx, user, card.id, 'ISO2026_CHECKLIST_DELETE', 'Checklist item deleted', { checklistItemId: itemId, title: existing.title });
      return { ok: true };
    });
  }

  async createDocument(user: IsoUser, code: string, body: unknown) {
    this.authorize(user, true);
    const clause = this.source.clause(code);
    const data = documentInput(body, true);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.ensureCard(tx, clause, user);
      const document = await tx.iso2026Document.create({ data: { ...data, cardId: card.id, createdById: user.id, updatedById: user.id }, include: documentInclude });
      await this.log(tx, user, card.id, 'ISO2026_DOCUMENT_CREATE', 'Document added', { documentId: document.id, title: document.title });
      return document;
    });
  }

  async updateDocument(user: IsoUser, code: string, documentId: string, body: unknown) {
    this.authorize(user, true);
    this.source.clause(code);
    const data = documentInput(body, false);
    this.requireChanges(data);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.existingCard(tx, code);
      const existing = await tx.iso2026Document.findFirst({ where: { id: documentId, cardId: card.id } });
      if (!existing) throw new NotFoundException('Document not found');
      const document = await tx.iso2026Document.update({ where: { id: documentId }, data: { ...data, updatedById: user.id }, include: documentInclude });
      await this.log(tx, user, card.id, 'ISO2026_DOCUMENT_UPDATE', 'Document updated', { documentId, fields: Object.keys(data) });
      return document;
    });
  }

  async deleteDocument(user: IsoUser, code: string, documentId: string) {
    this.authorize(user, true);
    this.source.clause(code);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.existingCard(tx, code);
      const existing = await tx.iso2026Document.findFirst({ where: { id: documentId, cardId: card.id } });
      if (!existing) throw new NotFoundException('Document not found');
      await tx.iso2026Document.delete({ where: { id: documentId } });
      await this.log(tx, user, card.id, 'ISO2026_DOCUMENT_DELETE', 'Document deleted', { documentId, title: existing.title });
      return { ok: true };
    });
  }

  async addLog(user: IsoUser, code: string, value: unknown) {
    this.authorize(user, true);
    const clause = this.source.clause(code);
    const body = objectBody(value, ['note']);
    const note = textField(body.note, 'note', true, 20000);
    return this.prisma.$transaction(async (tx: any) => {
      const card = await this.ensureCard(tx, clause, user);
      return this.log(tx, user, card.id, 'ISO2026_NOTE_CREATE', note, {});
    });
  }
}
