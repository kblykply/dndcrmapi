import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { TextDecoder } from 'node:util';
import { detectImageMime } from '../digital-map/digital-map-image.service';

export const types = ['INCIDENT', 'REQUEST'] as const;
export const categories = [
  'HARDWARE',
  'SOFTWARE',
  'ACCESS',
  'NETWORK',
  'EMAIL',
  'WEBSITE',
  'DATA',
  'OTHER',
] as const;
export const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const impacts = ['SINGLE', 'TEAM', 'COMPANY'] as const;
export const urgencies = ['LOW', 'NORMAL', 'HIGH'] as const;
export const statuses = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_REQUESTER',
  'WAITING_VENDOR',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export const visibilities = ['PUBLIC', 'INTERNAL'] as const;
export type Status = (typeof statuses)[number];
export const FILE_LIMIT = 5 * 1024 * 1024;
export const openStatuses: Status[] = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_REQUESTER',
  'WAITING_VENDOR',
];
export function invalid(message: string): never {
  throw new BadRequestException({ code: 'IT_SUPPORT_INVALID', message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('A JSON object is required.');
  return value as Record<string, unknown>;
}
export function payload(value: unknown) {
  const data = object(value);
  if (data.payload === undefined) return data;
  if (typeof data.payload !== 'string')
    invalid('Multipart payload must contain JSON.');
  try {
    return object(JSON.parse(data.payload));
  } catch {
    invalid('Multipart payload must contain valid JSON.');
  }
}
export function string(
  value: unknown,
  name: string,
  max: number,
  required = false,
) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\u0000')
  )
    invalid(`${name} must be at most ${max} characters.`);
  const result = value.trim();
  if (required && !result) invalid(`${name} is required.`);
  return result;
}
export function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !options.includes(value as T))
    invalid(`Invalid ${name}.`);
  return value as T;
}
export function identifier(value: unknown, name = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(value))
    invalid(`Invalid ${name}.`);
  return value;
}
export function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    invalid('A positive version is required.');
  return value as number;
}
export function createInput(value: unknown) {
  const x = payload(value);
  return {
    subject: string(x.subject, 'Subject', 160, true),
    description: string(x.description, 'Description', 10000, true),
    type: oneOf(x.type, types, 'type'),
    category: oneOf(x.category, categories, 'category'),
    impact: oneOf(x.impact, impacts, 'impact'),
    urgency: oneOf(x.urgency, urgencies, 'urgency'),
    system: string(x.system, 'System', 160),
    location: string(x.location, 'Location', 160),
  };
}
export function entryInput(value: unknown, hasFiles: boolean) {
  const x = payload(value);
  return {
    version: version(x.version),
    body: string(x.body, 'Reply', 5000, !hasFiles),
    visibility: oneOf(x.visibility, visibilities, 'visibility'),
  };
}
export function actionInput(value: unknown) {
  const x = object(value);
  const action = oneOf(
    x.action,
    ['CONFIRM', 'REOPEN', 'CANCEL'] as const,
    'action',
  );
  return {
    version: version(x.version),
    action,
    message: string(x.message, 'Reason', 5000, action !== 'CONFIRM'),
  };
}
export function triageInput(value: unknown) {
  const x = object(value);
  let dueAt: Date | null = null;
  if (x.dueAt !== null) {
    if (
      typeof x.dueAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
        x.dueAt,
      )
    )
      invalid('Due date must be an ISO timestamp or null.');
    dueAt = new Date(x.dueAt);
    if (!Number.isFinite(dueAt.getTime())) invalid('Invalid due date.');
    const day = x.dueAt.slice(0, 10);
    const dayDate = new Date(day + 'T00:00:00.000Z');
    if (
      !Number.isFinite(dayDate.getTime()) ||
      dayDate.toISOString().slice(0, 10) !== day
    )
      invalid('Invalid due date.');
  }
  return {
    version: version(x.version),
    category: oneOf(x.category, categories, 'category'),
    priority: oneOf(x.priority, priorities, 'priority'),
    status: oneOf(x.status, statuses, 'status'),
    assigneeId:
      x.assigneeId === null ? null : identifier(x.assigneeId, 'assigneeId'),
    dueAt,
    reason: string(x.reason, 'Reason', 5000),
  };
}
export function initialPriority(
  impact: (typeof impacts)[number],
  urgency: (typeof urgencies)[number],
): (typeof priorities)[number] {
  if (impact === 'COMPANY' && urgency === 'HIGH') return 'URGENT';
  if (
    (impact === 'TEAM' && urgency === 'HIGH') ||
    (impact === 'COMPANY' && urgency === 'NORMAL')
  )
    return 'HIGH';
  if (impact === 'SINGLE' && urgency === 'LOW') return 'LOW';
  return 'NORMAL';
}
export function allowedStatuses(status: Status): Status[] {
  if (openStatuses.includes(status))
    return [
      ...new Set([
        status,
        'IN_PROGRESS',
        'WAITING_REQUESTER',
        'WAITING_VENDOR',
        'RESOLVED',
        'CANCELLED',
      ] as Status[]),
    ];
  if (status === 'RESOLVED') return ['RESOLVED', 'CLOSED', 'IN_PROGRESS'];
  return [status, 'IN_PROGRESS'];
}
function recoverMultipartFilename(value: string) {
  // Busboy treats plain filename headers as Latin-1, while browsers send UTF-8.
  // Do not reinterpret correctly decoded non-Latin-1 characters or invalid UTF-8.
  if (/[^\u0000-\u00ff]/.test(value)) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'latin1'),
    );
  } catch {
    return value;
  }
}

export function validateFiles(files?: Express.Multer.File[]) {
  if (!files) return [];
  if (files.length > 3) invalid('At most three files may be uploaded at once.');
  return files.map((file) => {
    const b = file.buffer;
    if (!Buffer.isBuffer(b) || !b.length) invalid('Files must not be empty.');
    if (b.length > FILE_LIMIT)
      throw new PayloadTooLargeException({
        code: 'IT_SUPPORT_FILE_TOO_LARGE',
        message: 'Files must be at most 5 MiB.',
      });
    const name =
      (
        recoverMultipartFilename(file.originalname).split(/[\\/]/).pop() ||
        'Attachment'
      )
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 180) || 'Attachment';
    const extension = name.split('.').pop()?.toLowerCase();
    let mimeType: string | null = detectImageMime(b);
    const imageExts = {
      'image/png': ['png'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/webp': ['webp'],
    };
    if (
      mimeType &&
      (!imageExts[mimeType].includes(extension) || file.mimetype !== mimeType)
    )
      invalid('Image contents, extension and type must match.');
    if (
      !mimeType &&
      extension === 'pdf' &&
      file.mimetype === 'application/pdf' &&
      b.subarray(0, 5).toString('ascii') === '%PDF-' &&
      b.subarray(Math.max(0, b.length - 1024)).includes(Buffer.from('%%EOF'))
    )
      mimeType = 'application/pdf';
    if (!mimeType && extension === 'txt' && file.mimetype === 'text/plain') {
      let decoded = '';
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(b);
      } catch {
        invalid('Text files must use UTF-8.');
      }
      if (
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded) ||
        /<\s*(?:!doctype\s+html|html|svg|script)\b/i.test(decoded)
      )
        invalid('HTML, SVG and binary files are not supported.');
      mimeType = 'text/plain';
    }
    if (!mimeType)
      invalid('Supported files: PNG, JPEG, WebP, PDF and UTF-8 TXT.');
    return { name, mimeType, size: b.length, content: new Uint8Array(b) };
  });
}
