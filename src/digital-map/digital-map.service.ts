import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { invalidDigitalMap, validateDigitalMap } from './digital-map.dto';
import { assertDigitalMapIdentity } from './digital-map.guard';
import type { DigitalMapUser } from './digital-map.guard';

export const DIGITAL_MAP_ID = 'dnd-digital-map';

function versionConflict(): never {
  throw new ConflictException({
    code: 'DIGITAL_MAP_VERSION_CONFLICT',
    message:
      'This map was changed by another user. Reload the latest map before saving again.',
  });
}

@Injectable()
export class DigitalMapService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(user: DigitalMapUser) {
    assertDigitalMapIdentity(user);
    const actor = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!actor?.isActive || actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'An active administrator account is required.',
      );
    }
    return actor as { id: string; name: string };
  }

  async get(user: DigitalMapUser) {
    await this.authorize(user);
    const document = await this.prisma.digitalMapDocument.findUnique({
      where: { id: DIGITAL_MAP_ID },
    });
    return this.workspace(document);
  }

  async save(user: DigitalMapUser, input: unknown) {
    const actor = await this.authorize(user);
    // Also validate direct service calls, rather than relying on HTTP pipes alone.
    const body = validateDigitalMap(input);
    const imageIds = [
      ...new Set(
        body.nodes.flatMap((node) => (node.imageId ? [node.imageId] : [])),
      ),
    ];
    if (imageIds.length) {
      const images = await this.prisma.digitalMapImage.findMany({
        where: { id: { in: imageIds } },
        select: { id: true },
      });
      const available = new Set(
        images.map((image: { id: string }) => image.id),
      );
      if (imageIds.some((id) => !available.has(id))) {
        invalidDigitalMap(
          'One or more map images do not exist. Upload the image again before saving.',
        );
      }
    }
    const data = {
      name: body.name,
      nodes: body.nodes as Prisma.InputJsonValue,
      edges: body.edges as Prisma.InputJsonValue,
      updatedById: actor.id,
      updatedByName: actor.name,
    };

    if (body.version === 0) {
      try {
        const created = await this.prisma.digitalMapDocument.create({
          data: { id: DIGITAL_MAP_ID, ...data, version: 1 },
        });
        return this.workspace(created);
      } catch (error) {
        // The singleton primary key arbitrates concurrent first saves atomically.
        if ((error as { code?: string })?.code === 'P2002') versionConflict();
        throw error;
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.digitalMapDocument.updateMany({
        where: { id: DIGITAL_MAP_ID, version: body.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (changed.count !== 1) versionConflict();
      // Read before releasing the row lock so the response belongs to this save.
      const document = await tx.digitalMapDocument.findUniqueOrThrow({
        where: { id: DIGITAL_MAP_ID },
      });
      return this.workspace(document);
    });
  }

  private workspace(
    document: {
      id: string;
      name: string;
      nodes: unknown;
      edges: unknown;
      version: number;
      updatedAt: Date;
      updatedByName: string;
    } | null,
  ) {
    return {
      id: DIGITAL_MAP_ID,
      name: document?.name ?? 'DND Dijital Harita',
      nodes: document?.nodes ?? [],
      edges: document?.edges ?? [],
      version: document?.version ?? 0,
      updatedAt: document?.updatedAt.toISOString() ?? null,
      updatedByName: document?.updatedByName ?? null,
      canEdit: true,
    };
  }
}
