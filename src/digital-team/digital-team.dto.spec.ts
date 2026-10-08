import { BadRequestException } from '@nestjs/common';
import {
  validateMember,
  validateNote,
  validateProject,
  version,
} from './digital-team.dto';
import type { ProjectInput } from './digital-team.dto';

function project(): ProjectInput {
  return {
    kind: 'PROJECT',
    name: 'Portal improvement',
    summary: '',
    objective: '',
    status: 'PLANNED',
    priority: 'NORMAL',
    health: 'NOT_SET',
    ownerId: null,
    startDate: '2026-09-16',
    targetDate: '2026-10-01',
    cadence: '',
    progress: null,
    nextStep: '',
    links: [
      {
        id: 'link-1',
        label: 'Project',
        url: 'https://example.test/project',
        kind: 'WEBSITE',
      },
    ],
    workstreams: [
      {
        id: 'stream-1',
        title: 'Design',
        description: '',
        ownerId: null,
        status: 'PLANNED',
        targetDate: null,
      },
    ],
    factors: [
      {
        id: 'factor-1',
        title: 'Supplier response',
        source: 'Supplier',
        impact: 'RISK',
        status: 'OPEN',
        ownerId: null,
        targetDate: null,
        nextAction: '',
        notes: '',
        url: '',
      },
    ],
  };
}

describe('Digital Team validation', () => {
  it('accepts an explicit project with unknown progress and health', () => {
    expect(validateProject(project())).toEqual(project());
  });

  it('defaults missing health without inventing project progress', () => {
    expect(validateProject({ ...project(), health: undefined })).toMatchObject({
      health: 'NOT_SET',
      progress: null,
    });
  });

  it('accepts ongoing processes without a percentage', () => {
    expect(
      validateProject({
        ...project(),
        kind: 'PROCESS',
        cadence: 'Every week',
        progress: null,
      }),
    ).toMatchObject({ kind: 'PROCESS', progress: null });
  });

  it.each([null, 100])(
    'allows completed projects with explicit completed or unspecified progress %p',
    (progress) => {
      expect(
        validateProject({ ...project(), status: 'COMPLETED', progress })
          .progress,
      ).toBe(progress);
    },
  );

  it('accepts leap days and strips unknown metadata recursively', () => {
    const input = project();
    input.startDate = '2024-02-29';
    Object.assign(input, { updatedByName: 'Spoofed', canEdit: true });
    Object.assign(input.workstreams[0], { permission: 'ADMIN' });
    const clean = validateProject(input);
    expect(clean.startDate).toBe('2024-02-29');
    expect(clean).not.toHaveProperty('updatedByName');
    expect(clean.workstreams[0]).not.toHaveProperty('permission');
  });

  it.each([
    ['blank name', { name: '   ' }],
    ['long name', { name: 'x'.repeat(161) }],
    ['long summary', { summary: 'x'.repeat(5001) }],
    ['long objective', { objective: 'x'.repeat(5001) }],
    ['long next step', { nextStep: 'x'.repeat(2001) }],
    ['long cadence', { cadence: 'x'.repeat(161) }],
    ['unknown kind', { kind: 'OTHER' }],
    ['unknown status', { status: 'CLOSED' }],
    ['unknown priority', { priority: 'MEDIUM' }],
    ['null health', { health: null }],
    ['unknown health', { health: 'FINE' }],
    ['fractional percentage', { progress: 1.5 }],
    ['string percentage', { progress: '25' }],
    ['out-of-range percentage', { progress: 101 }],
    ['negative percentage', { progress: -1 }],
    ['infinite percentage', { progress: Infinity }],
    ['process percentage', { kind: 'PROCESS', progress: 0 }],
    ['incomplete completed project', { status: 'COMPLETED', progress: 50 }],
    ['invalid calendar day', { startDate: '2026-02-29' }],
    ['invalid month', { startDate: '2026-13-01' }],
    ['timestamp instead of date', { startDate: '2026-09-16T00:00:00Z' }],
    ['year zero', { startDate: '0000-01-01' }],
    ['reversed dates', { startDate: '2027-01-01' }],
    ['invalid member ID', { ownerId: 'bad/id' }],
    ['missing arrays', { workstreams: undefined }],
    ['too many links', { links: Array(21).fill({}) }],
    ['too many workstreams', { workstreams: Array(51).fill({}) }],
    ['too many factors', { factors: Array(31).fill({}) }],
  ])('rejects %s', (_label, fields) => {
    try {
      validateProject({ ...project(), ...fields });
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'DIGITAL_TEAM_INVALID',
      });
    }
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    '//example.test',
    'file:///private/tmp/a',
    'https://user:pass@example.test',
    'https://example.test/\npath',
    'https://',
  ])('rejects unsafe URL %s', (url) => {
    const input = project();
    input.links[0].url = url;
    expect(() => validateProject(input)).toThrow(BadRequestException);
    input.links = [];
    input.factors[0].url = url;
    expect(() => validateProject(input)).toThrow(BadRequestException);
  });

  it('requires distinct IDs across all child arrays', () => {
    const input = project();
    input.factors[0].id = input.workstreams[0].id;
    expect(() => validateProject(input)).toThrow('Duplicate child ID');
  });

  it.each([
    (input: ProjectInput) => {
      input.workstreams[0].description = 'x'.repeat(2001);
    },
    (input: ProjectInput) => {
      input.workstreams[0].targetDate = '2026-02-30';
    },
    (input: ProjectInput) => {
      input.factors[0].source = 'x'.repeat(161);
    },
    (input: ProjectInput) => {
      input.factors[0].nextAction = 'x'.repeat(2001);
    },
    (input: ProjectInput) => {
      input.factors[0].notes = 'x'.repeat(2001);
    },
    (input: ProjectInput) => {
      input.links[0].label = 'x'.repeat(161);
    },
    (input: ProjectInput) => {
      input.links[0].url = 'https://example.test/' + 'x'.repeat(2048);
    },
  ])('bounds nested fields and dates', (change) => {
    const input = project();
    change(input);
    expect(() => validateProject(input)).toThrow(BadRequestException);
  });

  it('allows account-free teammates and enforces exact member field bounds', () => {
    const member = {
      userId: null,
      name: 'Teammate',
      title: '',
      contact: 'x'.repeat(240),
      isActive: true,
    };
    expect(validateMember(member)).toEqual(member);
    expect(() =>
      validateMember({ ...member, contact: 'x'.repeat(241) }),
    ).toThrow(BadRequestException);
    expect(() => validateMember({ ...member, isActive: 'true' })).toThrow(
      BadRequestException,
    );
    expect(() => validateMember({ ...member, userId: '../user' })).toThrow(
      BadRequestException,
    );
  });

  it('requires a real version and a nonblank bounded note', () => {
    expect(validateNote({ version: 4, body: ' Progress update ' })).toEqual({
      version: 4,
      body: 'Progress update',
    });
    for (const candidate of [0, -1, 1.5, '1', 2147483647, undefined])
      expect(() => version(candidate)).toThrow(BadRequestException);
    expect(() => validateNote({ version: 1, body: ' ' })).toThrow(
      BadRequestException,
    );
    expect(() => validateNote({ version: 1, body: 'x'.repeat(5001) })).toThrow(
      BadRequestException,
    );
  });
});
