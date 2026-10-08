import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export const NODE_KINDS = [
  'SERVER',
  'MACHINE',
  'CLOUD',
  'SERVICE',
  'BACKEND',
  'DATABASE',
  'WEBSITE',
  'PANEL',
  'SYSTEM',
  'GROUP',
  'GATEWAY',
] as const;
export const EDGE_KINDS = [
  'ACCESS',
  'API',
  'DATABASE',
  'NETWORK',
  'DATA',
] as const;
export type DigitalMapNodeKind = (typeof NODE_KINDS)[number];
export type DigitalMapEdgeKind = (typeof EDGE_KINDS)[number];
export type DigitalMapNode = {
  id: string;
  kind: DigitalMapNodeKind;
  name: string;
  parentId: string | null;
  position: { x: number; y: number };
  width: number;
  height: number;
  address: string;
  technology: string;
  owner: string;
  notes: string;
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  status: 'ACTIVE' | 'PLANNED' | 'MAINTENANCE';
  systemKey?: string;
  url?: string;
  imageId?: string;
};
export type DigitalMapEdge = {
  id: string;
  source: string;
  target: string;
  kind: DigitalMapEdgeKind;
  label: string;
  protocol: string;
  access: string;
  notes: string;
  bidirectional?: boolean;
};
export type SaveDigitalMapDto = {
  name: string;
  nodes: DigitalMapNode[];
  edges: DigitalMapEdge[];
  version: number;
};

export function invalidDigitalMap(message: string): never {
  throw new BadRequestException({ code: 'DIGITAL_MAP_INVALID', message });
}

const invalid: (message: string) => never = invalidDigitalMap;

const CONTAINER_CHILDREN: Partial<
  Record<DigitalMapNodeKind, readonly DigitalMapNodeKind[]>
> = {
  SERVER: [
    'MACHINE',
    'SERVICE',
    'BACKEND',
    'DATABASE',
    'WEBSITE',
    'PANEL',
    'SYSTEM',
  ],
  MACHINE: ['SERVICE', 'BACKEND', 'DATABASE', 'WEBSITE', 'PANEL', 'SYSTEM'],
  CLOUD: [
    'SERVER',
    'MACHINE',
    'SERVICE',
    'BACKEND',
    'DATABASE',
    'WEBSITE',
    'PANEL',
    'SYSTEM',
    'GATEWAY',
  ],
  SERVICE: ['BACKEND', 'DATABASE', 'WEBSITE', 'PANEL', 'SYSTEM'],
};

function websiteUrl(value: unknown, path: string): string {
  const result = string(value, path, 2048).trim();
  if (!result) return '';
  if (!/^https?:\/\//i.test(result) || /[\u0000-\u001f\u007f]/.test(result)) {
    invalid(`${path} must be an absolute HTTP or HTTPS URL.`);
  }
  try {
    const url = new URL(result);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      invalid(
        `${path} must be an HTTP or HTTPS URL without embedded credentials.`,
      );
    }
  } catch {
    invalid(
      `${path} must be a valid HTTP or HTTPS URL without embedded credentials.`,
    );
  }
  return result;
}

function optionalImageId(value: unknown, path: string): string {
  return value === '' ? '' : id(value, path);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  path: string,
  max: number,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  ) {
    invalid(
      `${path} must be ${required ? 'a non-empty string' : 'a string'} of at most ${max} characters.`,
    );
  }
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, 120, true);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result)) {
    invalid(
      `${path} may only contain letters, numbers, underscores, dots, colons and hyphens.`,
    );
  }
  return result;
}

function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    invalid(`${path} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function choice<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(`${path} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    invalid(`${path} must be an array with at most ${max} items.`);
  }
  return value;
}

/** Rebuild the JSON document from known fields; never persist arbitrary input. */
export function validateDigitalMap(value: unknown): SaveDigitalMapDto {
  const input = object(value, 'Digital map');
  const name = string(input.name, 'name', 160, true);
  const version = number(input.version, 'version', 0, 2_147_483_646);
  if (!Number.isInteger(version)) invalid('version must be an integer.');

  const nodes = array(input.nodes, 'nodes', 250).map(
    (value, index): DigitalMapNode => {
      const path = `nodes[${index}]`;
      const node = object(value, path);
      const position = object(node.position, `${path}.position`);
      return {
        id: id(node.id, `${path}.id`),
        kind: choice(node.kind, `${path}.kind`, NODE_KINDS),
        name: string(node.name, `${path}.name`, 160, true),
        parentId:
          node.parentId === null ? null : id(node.parentId, `${path}.parentId`),
        position: {
          x: number(position.x, `${path}.position.x`, -100_000, 100_000),
          y: number(position.y, `${path}.position.y`, -100_000, 100_000),
        },
        width: number(node.width, `${path}.width`, 80, 10_000),
        height: number(node.height, `${path}.height`, 80, 10_000),
        address: string(node.address, `${path}.address`, 2048),
        technology: string(node.technology, `${path}.technology`, 240),
        owner: string(node.owner, `${path}.owner`, 160),
        notes: string(node.notes, `${path}.notes`, 4000),
        environment: choice(node.environment, `${path}.environment`, [
          'PRODUCTION',
          'STAGING',
          'DEVELOPMENT',
        ]),
        status: choice(node.status, `${path}.status`, [
          'ACTIVE',
          'PLANNED',
          'MAINTENANCE',
        ]),
        ...(node.systemKey === undefined
          ? {}
          : { systemKey: string(node.systemKey, `${path}.systemKey`, 80) }),
        ...(node.url === undefined
          ? {}
          : { url: websiteUrl(node.url, `${path}.url`) }),
        ...(node.imageId === undefined
          ? {}
          : { imageId: optionalImageId(node.imageId, `${path}.imageId`) }),
      };
    },
  );
  const nodesById = new Map<string, DigitalMapNode>();
  for (const node of nodes) {
    if (nodesById.has(node.id)) invalid(`Duplicate node ID: ${node.id}.`);
    nodesById.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent)
      invalid(`Parent ${node.parentId} of ${node.id} does not exist.`);
    if (parent.id === node.id)
      invalid(`Node ${node.id} cannot contain itself.`);
    const allowed = CONTAINER_CHILDREN[parent.kind] ?? [];
    if (!allowed.includes(node.kind)) {
      invalid(`${parent.kind} cannot contain ${node.kind} (${node.id}).`);
    }
    const visited = new Set([node.id]);
    let ancestor: DigitalMapNode | undefined = parent;
    while (ancestor) {
      if (visited.has(ancestor.id))
        invalid(`Container cycle detected at ${node.id}.`);
      visited.add(ancestor.id);
      if (visited.size > 8)
        invalid(`Container nesting for ${node.id} exceeds eight levels.`);
      ancestor = ancestor.parentId
        ? nodesById.get(ancestor.parentId)
        : undefined;
    }
  }

  const edges = array(input.edges, 'edges', 1000).map(
    (value, index): DigitalMapEdge => {
      const path = `edges[${index}]`;
      const edge = object(value, path);
      if (
        edge.bidirectional !== undefined &&
        typeof edge.bidirectional !== 'boolean'
      ) {
        invalid(`${path}.bidirectional must be a boolean.`);
      }
      return {
        id: id(edge.id, `${path}.id`),
        source: id(edge.source, `${path}.source`),
        target: id(edge.target, `${path}.target`),
        kind: choice(edge.kind, `${path}.kind`, EDGE_KINDS),
        label: string(edge.label, `${path}.label`, 240),
        protocol: string(edge.protocol, `${path}.protocol`, 160),
        access: string(edge.access, `${path}.access`, 240),
        notes: string(edge.notes, `${path}.notes`, 4000),
        ...(edge.bidirectional === undefined
          ? {}
          : { bidirectional: edge.bidirectional as boolean }),
      };
    },
  );
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) invalid(`Duplicate connection ID: ${edge.id}.`);
    edgeIds.add(edge.id);
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      invalid(`Connection ${edge.id} references a node that does not exist.`);
    }
    if (edge.source === edge.target)
      invalid(`Connection ${edge.id} cannot link a node to itself.`);
  }
  return { name, nodes, edges, version };
}

@Injectable()
export class DigitalMapValidationPipe implements PipeTransform<
  unknown,
  SaveDigitalMapDto
> {
  transform(value: unknown): SaveDigitalMapDto {
    return validateDigitalMap(value);
  }
}
