import { BadRequestException } from '@nestjs/common';

export type IsoUser = { id: string; role: string; email?: string };
export const ISO_WRITE_ROLES = ['ADMIN', 'MANAGER', 'AFTERSALES', 'SALES'] as const;
export const ISO_READ_ROLES = [...ISO_WRITE_ROLES, 'PREVIEW'] as const;
export const PROCESS_STATUSES = ['ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED'] as const;
export const CATEGORIES = ['CONTEXT', 'PLANNING', 'LEADERSHIP', 'SUPPORT', 'OPERATIONAL', 'PERFORMANCE', 'IMPROVEMENT', 'CONSTRUCTION', 'REAL_ESTATE_SALES', 'VALUE'] as const;
export const DOCUMENT_TYPES = ['PROCEDURE', 'POLICY', 'FORM', 'CHECKLIST', 'RECORD', 'DRAWING', 'CONTRACT', 'REPORT', 'OTHER'] as const;
export const DOCUMENT_STATUSES = ['DRAFT', 'ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED'] as const;
export type Input = Record<string, unknown>;

export function objectBody(value: unknown, allowed: readonly string[]): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('JSON object is required');
  const body = value as Input;
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new BadRequestException(`Unsupported field: ${key}`);
  }
  return body;
}
export function textField(value: unknown, field: string, required = false, max = 10000): string | null {
  if (value == null) {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text`);
  const text = value.trim();
  if (required && !text) throw new BadRequestException(`${field} is required`);
  if (text.length > max) throw new BadRequestException(`${field} is too long`);
  return text || null;
}
export function enumField(value: unknown, allowed: readonly string[], field: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new BadRequestException(`Invalid ${field}`);
  return value;
}
export function boolField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be true or false`);
  return value;
}
export function sortField(value: unknown): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || Math.abs(number) > 2147483647) throw new BadRequestException('sortOrder must be a valid integer');
  return number;
}
export function dateField(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) throw new BadRequestException('Invalid dueAt');
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00.000Z`);
  const date = new Date(value);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day || !Number.isFinite(date.getTime())) throw new BadRequestException('Invalid dueAt');
  return date;
}
export function urlField(value: unknown): string | null {
  const raw = textField(value, 'url', false, 4096);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new BadRequestException('url must be an HTTP or HTTPS address without embedded credentials');
  }
  return raw;
}
export function cardInput(value: unknown): Input {
  const body = objectBody(value, ['title', 'description', 'category', 'status', 'ownerDepartment', 'color', 'sortOrder']);
  const data: Input = {};
  for (const key of ['title', 'description', 'ownerDepartment']) if (key in body) data[key] = textField(body[key], key, key === 'title', key === 'description' ? 20000 : 300);
  if ('color' in body) {
    data.color = textField(body.color, 'color', false, 9);
    if (data.color && !/^#[0-9a-fA-F]{6}$/.test(data.color as string)) throw new BadRequestException('color must be a six digit hex color');
  }
  if ('status' in body) data.status = enumField(body.status, PROCESS_STATUSES, 'status');
  if ('category' in body) data.category = enumField(body.category, CATEGORIES, 'category');
  if ('sortOrder' in body) data.sortOrder = sortField(body.sortOrder);
  return data;
}
export function checklistInput(value: unknown, create: boolean): Input {
  const body = objectBody(value, ['title', 'description', 'required', 'isChecked', 'dueAt', 'sortOrder']);
  const data: Input = {};
  if (create || 'title' in body) data.title = textField(body.title, 'title', true, 1000);
  if ('description' in body) data.description = textField(body.description, 'description');
  for (const key of ['required', 'isChecked']) if (key in body) data[key] = boolField(body[key], key);
  if ('dueAt' in body) data.dueAt = dateField(body.dueAt);
  if ('sortOrder' in body) data.sortOrder = sortField(body.sortOrder);
  return data;
}
export function documentInput(value: unknown, create: boolean): Input {
  const body = objectBody(value, ['title', 'type', 'status', 'revision', 'ownerDepartment', 'url', 'storagePath', 'fileName', 'notes']);
  const data: Input = {};
  if (create || 'title' in body) data.title = textField(body.title, 'title', true, 1000);
  for (const key of ['revision', 'ownerDepartment', 'storagePath', 'fileName', 'notes']) if (key in body) data[key] = textField(body[key], key, false, key === 'notes' ? 10000 : 1000);
  if ('type' in body) data.type = enumField(body.type, DOCUMENT_TYPES, 'document type');
  if ('status' in body) data.status = enumField(body.status, DOCUMENT_STATUSES, 'document status');
  if ('url' in body) data.url = urlField(body.url);
  return data;
}
