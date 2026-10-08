import { BadRequestException } from '@nestjs/common';

export const recordKinds = ['PROJECT', 'PROCESS'] as const;
export const projectStatuses = [
  'PLANNED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export const priorities = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export const healthValues = [
  'NOT_SET',
  'ON_TRACK',
  'AT_RISK',
  'BLOCKED',
] as const;
export const workstreamStatuses = [
  'PLANNED',
  'ACTIVE',
  'WAITING',
  'PAUSED',
  'DONE',
] as const;
export const factorImpacts = ['INFO', 'RISK', 'BLOCKING'] as const;
export const linkKinds = [
  'WEBSITE',
  'PANEL',
  'REPOSITORY',
  'DOCUMENT',
  'OTHER',
] as const;

export type MemberInput = {
  userId: string | null;
  name: string;
  title: string;
  contact: string;
  isActive: boolean;
};
export type ProjectLink = {
  id: string;
  label: string;
  url: string;
  kind: (typeof linkKinds)[number];
};
export type Workstream = {
  id: string;
  title: string;
  description: string;
  ownerId: string | null;
  status: (typeof workstreamStatuses)[number];
  targetDate: string | null;
};
export type ExternalFactor = {
  id: string;
  title: string;
  source: string;
  impact: (typeof factorImpacts)[number];
  status: 'OPEN' | 'RESOLVED';
  ownerId: string | null;
  targetDate: string | null;
  nextAction: string;
  notes: string;
  url: string;
};
export type ProjectInput = {
  kind: (typeof recordKinds)[number];
  name: string;
  summary: string;
  objective: string;
  status: (typeof projectStatuses)[number];
  priority: (typeof priorities)[number];
  health: (typeof healthValues)[number];
  ownerId: string | null;
  startDate: string | null;
  targetDate: string | null;
  cadence: string;
  progress: number | null;
  nextStep: string;
  links: ProjectLink[];
  workstreams: Workstream[];
  factors: ExternalFactor[];
};

export function invalidTeam(message: string): never {
  throw new BadRequestException({ code: 'DIGITAL_TEAM_INVALID', message });
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidTeam(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  path: string,
  maximum: number,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    (required && !value.trim())
  ) {
    invalidTeam(
      `${path} must be ${required ? 'a non-empty string' : 'a string'} of at most ${maximum} characters.`,
    );
  }
  return required ? value.trim() : value;
}

export function identifier(value: unknown, path: string): string {
  const result = text(value, path, 120, true);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result))
    invalidTeam(`${path} contains invalid identifier characters.`);
  return result;
}

function nullableIdentifier(value: unknown, path: string): string | null {
  return value === null ? null : identifier(value, path);
}

function choice<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    invalidTeam(`${path} must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

export function version(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2_147_483_646
  )
    invalidTeam('version must be an integer from 1 through 2147483646.');
  return value;
}

function day(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) === 0
  )
    invalidTeam(`${path} must be a real date in YYYY-MM-DD format or null.`);
  const date = new Date(value + 'T00:00:00.000Z');
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalidTeam(`${path} must be a real calendar date.`);
  return value;
}

function url(value: unknown, path: string, required = false): string {
  const result = text(value, path, 2048, required).trim();
  if (!result) return '';
  if (!/^https?:\/\//i.test(result) || /[\u0000-\u001f\u007f]/.test(result))
    invalidTeam(`${path} must be an absolute HTTP or HTTPS URL.`);
  try {
    const parsed = new URL(result);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      invalidTeam(
        `${path} must be an HTTP or HTTPS URL without embedded credentials.`,
      );
  } catch {
    invalidTeam(
      `${path} must be a valid HTTP or HTTPS URL without embedded credentials.`,
    );
  }
  return result;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    invalidTeam(`${path} must be an array with at most ${maximum} items.`);
  return value;
}

export function validateMember(value: unknown): MemberInput {
  const input = record(value, 'Team member');
  if (typeof input.isActive !== 'boolean')
    invalidTeam('isActive must be a boolean.');
  return {
    userId: nullableIdentifier(input.userId, 'userId'),
    name: text(input.name, 'name', 160, true),
    title: text(input.title, 'title', 160),
    contact: text(input.contact, 'contact', 240),
    isActive: input.isActive,
  };
}

export function validateProject(value: unknown): ProjectInput {
  const input = record(value, 'Project');
  const kind = choice(input.kind, 'kind', recordKinds);
  const status = choice(input.status, 'status', projectStatuses);
  const progress = input.progress;
  if (
    progress !== null &&
    (typeof progress !== 'number' ||
      !Number.isInteger(progress) ||
      progress < 0 ||
      progress > 100)
  )
    invalidTeam(
      'progress must be an integer from 0 through 100, or null when unspecified.',
    );
  if (kind === 'PROCESS' && progress !== null)
    invalidTeam('Ongoing processes must have progress set to null.');
  if (
    kind === 'PROJECT' &&
    status === 'COMPLETED' &&
    progress !== null &&
    progress !== 100
  )
    invalidTeam(
      'A completed project with a progress value must be at 100 percent.',
    );
  const startDate = day(input.startDate, 'startDate');
  const targetDate = day(input.targetDate, 'targetDate');
  if (startDate && targetDate && startDate > targetDate)
    invalidTeam('targetDate cannot be earlier than startDate.');
  const links = array(input.links, 'links', 20).map(
    (value, index): ProjectLink => {
      const path = `links[${index}]`;
      const link = record(value, path);
      return {
        id: identifier(link.id, `${path}.id`),
        label: text(link.label, `${path}.label`, 160, true),
        url: url(link.url, `${path}.url`, true),
        kind: choice(link.kind, `${path}.kind`, linkKinds),
      };
    },
  );
  const workstreams = array(input.workstreams, 'workstreams', 50).map(
    (value, index): Workstream => {
      const path = `workstreams[${index}]`;
      const stream = record(value, path);
      return {
        id: identifier(stream.id, `${path}.id`),
        title: text(stream.title, `${path}.title`, 160, true),
        description: text(stream.description, `${path}.description`, 2000),
        ownerId: nullableIdentifier(stream.ownerId, `${path}.ownerId`),
        status: choice(stream.status, `${path}.status`, workstreamStatuses),
        targetDate: day(stream.targetDate, `${path}.targetDate`),
      };
    },
  );
  const factors = array(input.factors, 'factors', 30).map(
    (value, index): ExternalFactor => {
      const path = `factors[${index}]`;
      const factor = record(value, path);
      return {
        id: identifier(factor.id, `${path}.id`),
        title: text(factor.title, `${path}.title`, 160, true),
        source: text(factor.source, `${path}.source`, 160),
        impact: choice(factor.impact, `${path}.impact`, factorImpacts),
        status: choice(factor.status, `${path}.status`, ['OPEN', 'RESOLVED']),
        ownerId: nullableIdentifier(factor.ownerId, `${path}.ownerId`),
        targetDate: day(factor.targetDate, `${path}.targetDate`),
        nextAction: text(factor.nextAction, `${path}.nextAction`, 2000),
        notes: text(factor.notes, `${path}.notes`, 2000),
        url: url(factor.url, `${path}.url`),
      };
    },
  );
  const childIds = new Set<string>();
  for (const child of [...links, ...workstreams, ...factors]) {
    if (childIds.has(child.id)) invalidTeam(`Duplicate child ID: ${child.id}.`);
    childIds.add(child.id);
  }
  return {
    kind,
    name: text(input.name, 'name', 160, true),
    summary: text(input.summary, 'summary', 5000),
    objective: text(input.objective, 'objective', 5000),
    status,
    priority: choice(input.priority, 'priority', priorities),
    health: choice(
      input.health === undefined ? 'NOT_SET' : input.health,
      'health',
      healthValues,
    ),
    ownerId: nullableIdentifier(input.ownerId, 'ownerId'),
    startDate,
    targetDate,
    cadence: text(input.cadence, 'cadence', 160),
    progress: progress as number | null,
    nextStep: text(input.nextStep, 'nextStep', 2000),
    links,
    workstreams,
    factors,
  };
}

export function validateNote(value: unknown): {
  version: number;
  body: string;
} {
  const input = record(value, 'Update');
  return {
    version: version(input.version),
    body: text(input.body, 'body', 5000, true),
  };
}
