import {
  actionInput,
  allowedStatuses,
  createInput,
  entryInput,
  initialPriority,
  payload,
  triageInput,
  validateFiles,
} from './it-support.dto';
import { assertItIdentity } from './it-support.guard';

const creation = {
  subject: 'Printer unavailable',
  description: 'Printing fails on floor 2.',
  type: 'INCIDENT',
  category: 'HARDWARE',
  impact: 'TEAM',
  urgency: 'HIGH',
  system: 'Printer',
  location: 'Floor 2',
};
const triage = {
  version: 1,
  category: 'HARDWARE',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  assigneeId: null,
  dueAt: null,
  reason: '',
};
function file(name: string, mimetype: string, buffer: Buffer) {
  return {
    originalname: name,
    mimetype,
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

describe('IT support validation and rules', () => {
  it('validates create and strips client supplied requester and status', () => {
    expect(
      createInput({ ...creation, requesterId: 'other', status: 'CLOSED' }),
    ).toEqual(creation);
    expect(payload({ payload: JSON.stringify(creation) })).toEqual(creation);
  });
  it.each([null, [], { payload: '{' }, { payload: '[]' }, { payload: 5 }])(
    'rejects malformed input %p',
    (value) => expect(() => createInput(value)).toThrow(),
  );
  it.each([
    'subject',
    'description',
    'type',
    'category',
    'impact',
    'urgency',
    'system',
    'location',
  ])('rejects missing %s', (field) => {
    const input = { ...creation };
    delete input[field];
    expect(() => createInput(input)).toThrow();
  });
  it.each([
    ['subject', 161],
    ['description', 10001],
    ['system', 161],
    ['location', 161],
  ])('enforces %s limit', (field, length) =>
    expect(() =>
      createInput({ ...creation, [field]: 'x'.repeat(Number(length)) }),
    ).toThrow(),
  );
  it('requires nonempty description and subject', () => {
    expect(() => createInput({ ...creation, subject: ' ' })).toThrow();
    expect(() => createInput({ ...creation, description: ' ' })).toThrow();
  });
  it.each([
    ['SINGLE', 'LOW', 'LOW'],
    ['SINGLE', 'NORMAL', 'NORMAL'],
    ['SINGLE', 'HIGH', 'NORMAL'],
    ['TEAM', 'LOW', 'NORMAL'],
    ['TEAM', 'NORMAL', 'NORMAL'],
    ['TEAM', 'HIGH', 'HIGH'],
    ['COMPANY', 'LOW', 'NORMAL'],
    ['COMPANY', 'NORMAL', 'HIGH'],
    ['COMPANY', 'HIGH', 'URGENT'],
  ])('triages %s + %s to %s', (impact, urgency, priority) =>
    expect(initialPriority(impact as any, urgency as any)).toBe(priority),
  );
  it('allows attachment-only reply but never an empty standalone reply', () => {
    expect(
      entryInput({ version: 1, body: '', visibility: 'PUBLIC' }, true).body,
    ).toBe('');
    expect(() =>
      entryInput({ version: 1, body: '', visibility: 'PUBLIC' }, false),
    ).toThrow();
    expect(() =>
      entryInput(
        { version: 1, body: 'x'.repeat(5001), visibility: 'INTERNAL' },
        false,
      ),
    ).toThrow();
  });
  it.each([0, -1, 1.2, '1', null, Number.MAX_SAFE_INTEGER + 1])(
    'rejects bad version %p',
    (version) =>
      expect(() =>
        entryInput({ version, body: 'reply', visibility: 'PUBLIC' }, false),
      ).toThrow(),
  );
  it('requires cancellation and reopening reasons but confirmation can be empty', () => {
    for (const action of ['CANCEL', 'REOPEN'])
      expect(() => actionInput({ version: 1, action, message: ' ' })).toThrow();
    expect(
      actionInput({ version: 1, action: 'CONFIRM', message: '' }).action,
    ).toBe('CONFIRM');
  });
  it.each([
    '2026-02-30T12:00:00Z',
    '2026-09-16',
    'not-a-date',
    '2026-09-16T99:00:00Z',
    1,
    undefined,
  ])('rejects invalid timestamp %p', (dueAt) =>
    expect(() => triageInput({ ...triage, dueAt })).toThrow(),
  );
  it('accepts null or ISO due dates', () => {
    expect(triageInput(triage).dueAt).toBeNull();
    expect(
      triageInput({
        ...triage,
        dueAt: '2026-09-16T12:00:00+03:00',
      }).dueAt?.toISOString(),
    ).toBe('2026-09-16T09:00:00.000Z');
  });
  it('never allows arbitrary NEW reset and limits closed transitions', () => {
    expect(allowedStatuses('IN_PROGRESS')).not.toContain('NEW');
    expect(allowedStatuses('RESOLVED')).toEqual([
      'RESOLVED',
      'CLOSED',
      'IN_PROGRESS',
    ]);
    expect(allowedStatuses('CANCELLED')).toEqual(['CANCELLED', 'IN_PROGRESS']);
  });
  it.each([
    'ADMIN',
    'MANAGER',
    'SALES',
    'CALLCENTER',
    'AFTERSALES',
    'ACCOUNTING',
  ])('accepts employee identity %s', (role) =>
    expect(() => assertItIdentity({ id: 'user', role })).not.toThrow(),
  );
  it.each([
    { id: 'user', role: 'PREVIEW' },
    { id: 'user', role: 'ADMIN', isPreview: true },
    { id: 'user', role: 'ADMIN', originalRole: 'PREVIEW' },
    { id: 'user', role: 'OTHER' },
    undefined,
  ])('rejects preview/unknown identity %p', (user) =>
    expect(() => assertItIdentity(user)).toThrow(),
  );
  it('accepts bounded UTF8 plain text and sanitizes filename', () => {
    const result = validateFiles([
      file('../../café\u0000.txt', 'text/plain', Buffer.from('Merhaba dünya')),
    ]);
    expect(result[0]).toMatchObject({
      name: 'café.txt',
      mimeType: 'text/plain',
      size: 14,
    });
  });

  it.each(['bağlantı-İŞ.txt', 'görüntü.txt', 'café.txt', '日本語.txt'])(
    'preserves an already decoded Unicode filename %s',
    (name) => {
      expect(
        validateFiles([file(name, 'text/plain', Buffer.from('safe'))])[0].name,
      ).toBe(name);
    },
  );

  it('recovers raw UTF8 filename bytes before path and control sanitization', () => {
    const name = Buffer.from(
      '../görüntü/bağlantı\u0000-İŞ.txt',
      'utf8',
    ).toString('latin1');
    expect(
      validateFiles([file(name, 'text/plain', Buffer.from('safe'))])[0].name,
    ).toBe('bağlantı-İŞ.txt');
  });
  it('accepts PDF signature and EOF', () =>
    expect(
      validateFiles([
        file(
          'test.pdf',
          'application/pdf',
          Buffer.from('%PDF-1.7\ncontent\n%%EOF'),
        ),
      ])[0].mimeType,
    ).toBe('application/pdf'));
  it.each([
    file('empty.txt', 'text/plain', Buffer.alloc(0)),
    file('bad.txt', 'text/plain', Buffer.from([0xff])),
    file('bad.txt', 'text/plain', Buffer.from('<html>test</html>')),
    file('bad.txt', 'text/plain', Buffer.from('<svg></svg>')),
    file('file.svg', 'image/svg+xml', Buffer.from('<svg/>')),
    file('file.html', 'text/html', Buffer.from('<html/>')),
    file('bad.pdf', 'application/pdf', Buffer.from('%PDF-1.7 fake')),
    file('fake.png', 'image/png', Buffer.from('not png')),
    file('bad.txt', 'text/plain', Buffer.from([0])),
    file('huge.txt', 'text/plain', Buffer.alloc(5 * 1024 * 1024 + 1, 65)),
  ])('rejects unsafe file $originalname', (f) =>
    expect(() => validateFiles([f])).toThrow(),
  );
  it('rejects more than three files', () =>
    expect(() =>
      validateFiles(
        Array.from({ length: 4 }, () =>
          file('test.txt', 'text/plain', Buffer.from('safe')),
        ),
      ),
    ).toThrow());
});
