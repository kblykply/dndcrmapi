import { BadRequestException } from '@nestjs/common';
import { validateDigitalMap } from './digital-map.dto';

export function mapFixture() {
  const node = (id: string, kind: string, parentId: string | null = null) => ({
    id,
    kind,
    parentId,
    name: id,
    position: { x: 120, y: 240 },
    width: 360,
    height: 200,
    address: '',
    technology: '',
    owner: '',
    notes: '',
    environment: 'PRODUCTION',
    status: 'ACTIVE',
  });
  return {
    name: 'DND Dijital Harita',
    version: 0,
    nodes: [
      node('server', 'SERVER'),
      node('machine', 'MACHINE', 'server'),
      node('backend', 'BACKEND', 'machine'),
      node('database', 'DATABASE', 'machine'),
      node('website', 'WEBSITE'),
    ],
    edges: [
      {
        id: 'web-api',
        source: 'website',
        target: 'backend',
        kind: 'API',
        label: 'API',
        protocol: 'HTTPS',
        access: '',
        notes: '',
      },
    ],
  };
}

describe('validateDigitalMap', () => {
  it('accepts a complete nested server/machine/backend/database graph', () => {
    expect(validateDigitalMap(mapFixture())).toEqual(mapFixture());
  });

  it('allows an empty document to be saved intentionally', () => {
    expect(
      validateDigitalMap({ name: 'Empty', nodes: [], edges: [], version: 4 }),
    ).toEqual({ name: 'Empty', nodes: [], edges: [], version: 4 });
  });

  it('persists only known fields, including nested objects', () => {
    const input = mapFixture();
    Object.assign(input, { canEdit: true, updatedByName: 'Impersonated' });
    Object.assign(input.nodes[0], { credentials: 'do not persist' });
    Object.assign(input.nodes[0].position, { z: 7 });
    Object.assign(input.edges[0], { unknown: true });
    expect(validateDigitalMap(input)).toEqual(mapFixture());
  });

  const invalidCases: [
    string,
    (value: ReturnType<typeof mapFixture>) => void,
  ][] = [
    [
      'blank name',
      (v) => {
        v.name = '  ';
      },
    ],
    [
      'name too long',
      (v) => {
        v.name = 'a'.repeat(161);
      },
    ],
    [
      'fractional version',
      (v) => {
        v.version = 1.5;
      },
    ],
    [
      'negative version',
      (v) => {
        v.version = -1;
      },
    ],
    [
      'version overflow',
      (v) => {
        v.version = 2_147_483_647;
      },
    ],
    [
      'unknown node kind',
      (v) => {
        v.nodes[0].kind = 'UNKNOWN';
      },
    ],
    [
      'duplicate node IDs',
      (v) => {
        v.nodes[1].id = v.nodes[0].id;
      },
    ],
    [
      'malformed ID',
      (v) => {
        v.nodes[0].id = 'server/invalid';
      },
    ],
    [
      'missing parent',
      (v) => {
        v.nodes[1].parentId = 'missing';
      },
    ],
    [
      'self parent',
      (v) => {
        v.nodes[0].parentId = v.nodes[0].id;
      },
    ],
    [
      'cyclic parents',
      (v) => {
        v.nodes[0].parentId = 'machine';
      },
    ],
    [
      'non-container parent',
      (v) => {
        v.nodes[2].parentId = 'website';
      },
    ],
    [
      'unsupported child kind',
      (v) => {
        v.nodes[4].kind = 'GROUP';
        v.nodes[4].parentId = 'server';
      },
    ],
    [
      'infinite coordinate',
      (v) => {
        v.nodes[0].position.x = Infinity;
      },
    ],
    [
      'NaN coordinate',
      (v) => {
        v.nodes[0].position.y = NaN;
      },
    ],
    [
      'coordinate too large',
      (v) => {
        v.nodes[0].position.x = 100_001;
      },
    ],
    [
      'zero width',
      (v) => {
        v.nodes[0].width = 0;
      },
    ],
    [
      'height too large',
      (v) => {
        v.nodes[0].height = 10_001;
      },
    ],
    [
      'unknown environment',
      (v) => {
        v.nodes[0].environment = 'OTHER';
      },
    ],
    [
      'unknown status',
      (v) => {
        v.nodes[0].status = 'OTHER';
      },
    ],
    [
      'notes too long',
      (v) => {
        v.nodes[0].notes = 'a'.repeat(4001);
      },
    ],
    [
      'unknown connection kind',
      (v) => {
        v.edges[0].kind = 'OTHER';
      },
    ],
    [
      'duplicate connection IDs',
      (v) => {
        v.edges.push({ ...v.edges[0] });
      },
    ],
    [
      'dangling source',
      (v) => {
        v.edges[0].source = 'missing';
      },
    ],
    [
      'dangling target',
      (v) => {
        v.edges[0].target = 'missing';
      },
    ],
    [
      'self connection',
      (v) => {
        v.edges[0].target = v.edges[0].source;
      },
    ],
    [
      'too many nodes',
      (v) => {
        v.nodes = Array.from({ length: 251 }, (_, i) => ({
          ...v.nodes[0],
          id: `node-${i}`,
        }));
      },
    ],
    [
      'too many connections',
      (v) => {
        v.edges = Array.from({ length: 1001 }, (_, i) => ({
          ...v.edges[0],
          id: `edge-${i}`,
        }));
      },
    ],
  ];

  it('accepts cloud service containers, panels and bidirectional data links', () => {
    const input = mapFixture();
    input.nodes[0].kind = 'CLOUD';
    input.nodes[1].kind = 'SERVICE';
    input.nodes[4].kind = 'PANEL';
    input.nodes[4].parentId = 'machine';
    Object.assign(input.nodes[4], {
      systemKey: 'crm',
      url: 'https://crm.example.com/panel',
      imageId: 'image-1',
    });
    input.edges[0].kind = 'DATA';
    Object.assign(input.edges[0], { bidirectional: true });
    expect(validateDigitalMap(input)).toEqual(input);
  });

  it('accepts clearing optional screenshot and URL references', () => {
    const input = mapFixture();
    Object.assign(input.nodes[4], { systemKey: '', url: '', imageId: '' });
    Object.assign(input.edges[0], { bidirectional: false });
    expect(validateDigitalMap(input)).toEqual(input);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//example.com',
    'file:///etc/passwd',
    'ftp://example.com',
    'http:example.com',
    'https://',
    'https://user:password@example.com',
    'https://example.com/\npath',
  ])('rejects unsafe or malformed URL %s', (url) => {
    const input = mapFixture();
    Object.assign(input.nodes[0], { url });
    expect(() => validateDigitalMap(input)).toThrow(BadRequestException);
  });

  it.each([
    { systemKey: 'a'.repeat(81) },
    { imageId: 'bad/image' },
    { imageId: null },
    { url: 'https://example.com/' + 'a'.repeat(2048) },
  ])('bounds optional node metadata %p', (fields) => {
    const input = mapFixture();
    Object.assign(input.nodes[0], fields);
    expect(() => validateDigitalMap(input)).toThrow(BadRequestException);
  });

  it('does not coerce a string into a bidirectional flag', () => {
    const input = mapFixture();
    Object.assign(input.edges[0], { bidirectional: 'false' });
    expect(() => validateDigitalMap(input)).toThrow(BadRequestException);
  });

  it.each(invalidCases)(
    'rejects %s with a stable error code',
    (_name, change) => {
      const input = mapFixture();
      change(input);
      try {
        validateDigitalMap(input);
        throw new Error('Expected validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'DIGITAL_MAP_INVALID',
          message: expect.any(String),
        });
      }
    },
  );

  it.each([
    null,
    [],
    'string',
    {},
    { ...mapFixture(), nodes: null },
    { ...mapFixture(), edges: {} },
  ])('rejects malformed document %p', (input) => {
    expect(() => validateDigitalMap(input)).toThrow(BadRequestException);
  });
});
