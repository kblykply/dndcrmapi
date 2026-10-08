import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { DigitalMapService, DIGITAL_MAP_ID } from './digital-map.service';

const user = { id: 'admin-id', role: 'ADMIN' };
const actor = {
  id: 'admin-id',
  role: 'ADMIN',
  name: 'Actual Account Name',
  isActive: true,
};
const input = { name: 'DND Dijital Harita', nodes: [], edges: [], version: 0 };
const saved = {
  id: DIGITAL_MAP_ID,
  ...input,
  version: 1,
  updatedById: actor.id,
  updatedByName: actor.name,
  updatedAt: new Date('2026-09-15T10:00:00.000Z'),
};

describe('DigitalMapService', () => {
  let database: {
    user: { findUnique: jest.Mock };
    digitalMapDocument: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
    digitalMapImage: { findMany: jest.Mock };
  };
  let service: DigitalMapService;

  beforeEach(() => {
    database = {
      user: { findUnique: jest.fn().mockResolvedValue(actor) },
      digitalMapImage: { findMany: jest.fn().mockResolvedValue([]) },
      digitalMapDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(saved),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...saved, version: 2 }),
      },
      $transaction: jest.fn((operation) => operation(database)),
    };
    service = new DigitalMapService(database as unknown as PrismaService);
  });

  it('returns a clean absent workspace without creating sample infrastructure', async () => {
    await expect(service.get(user)).resolves.toEqual({
      id: DIGITAL_MAP_ID,
      ...input,
      updatedAt: null,
      updatedByName: null,
      canEdit: true,
    });
    expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
  });

  it('loads saved data with only public metadata', async () => {
    database.digitalMapDocument.findUnique.mockResolvedValue(saved);
    await expect(service.get(user)).resolves.toEqual({
      id: DIGITAL_MAP_ID,
      ...input,
      version: 1,
      updatedAt: saved.updatedAt.toISOString(),
      updatedByName: actor.name,
      canEdit: true,
    });
  });

  it('attributes first save to the database account and starts at version 1', async () => {
    await expect(
      service.save(user, { ...input, updatedByName: 'Spoofed' }),
    ).resolves.toMatchObject({ version: 1, updatedByName: actor.name });
    expect(database.digitalMapDocument.create).toHaveBeenCalledWith({
      data: {
        id: DIGITAL_MAP_ID,
        name: input.name,
        nodes: [],
        edges: [],
        version: 1,
        updatedById: actor.id,
        updatedByName: actor.name,
      },
    });
  });

  it('does not overwrite a competing first save', async () => {
    database.digitalMapDocument.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.save(user, input)).rejects.toMatchObject({
      response: { code: 'DIGITAL_MAP_VERSION_CONFLICT' },
      status: 409,
    });
    expect(database.digitalMapDocument.updateMany).not.toHaveBeenCalled();
  });

  it('compares and increments the version atomically before returning the saved document', async () => {
    await expect(
      service.save(user, { ...input, version: 1 }),
    ).resolves.toMatchObject({ version: 2 });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.digitalMapDocument.updateMany).toHaveBeenCalledWith({
      where: { id: DIGITAL_MAP_ID, version: 1 },
      data: {
        name: input.name,
        nodes: [],
        edges: [],
        updatedById: actor.id,
        updatedByName: actor.name,
        version: { increment: 1 },
      },
    });
  });

  it('rejects stale revisions without reading or returning newer content', async () => {
    database.digitalMapDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.save(user, { ...input, version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      database.digitalMapDocument.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });

  it('preserves unexpected database errors', async () => {
    database.digitalMapDocument.create.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(service.save(user, input)).rejects.toThrow(
      'database unavailable',
    );
  });

  it('validates direct service saves before storing anything', async () => {
    await expect(
      service.save(user, { ...input, nodes: [{ id: 'invalid' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  const screenshotNode = {
    id: 'system',
    kind: 'SYSTEM',
    name: 'CRM',
    parentId: null,
    position: { x: 0, y: 0 },
    width: 300,
    height: 160,
    address: '',
    technology: '',
    owner: '',
    notes: '',
    environment: 'PRODUCTION',
    status: 'ACTIVE',
    imageId: 'image-1',
  };

  it('rejects nonexistent screenshot references without saving the map', async () => {
    await expect(
      service.save(user, { ...input, nodes: [screenshotNode] }),
    ).rejects.toMatchObject({ response: { code: 'DIGITAL_MAP_INVALID' } });
    expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
  });

  it('looks up screenshot references as metadata, without loading their image bytes', async () => {
    database.digitalMapImage.findMany.mockResolvedValue([{ id: 'image-1' }]);
    await expect(
      service.save(user, { ...input, nodes: [screenshotNode] }),
    ).resolves.toMatchObject({ version: 1 });
    expect(database.digitalMapImage.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['image-1'] } },
      select: { id: true },
    });
    expect(database.digitalMapDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nodes: [screenshotNode] }),
      }),
    );
  });

  it('allows removing an image reference without deleting the uploaded image', async () => {
    await expect(
      service.save(user, {
        ...input,
        nodes: [{ ...screenshotNode, imageId: '' }],
      }),
    ).resolves.toMatchObject({ version: 1 });
    expect(database.digitalMapImage.findMany).not.toHaveBeenCalled();
  });

  it.each([
    'MANAGER',
    'PREVIEW',
    'SALES',
    'CALLCENTER',
    'ACCOUNTING',
    'AFTERSALES',
  ])('rejects %s service access before any database query', async (role) => {
    await expect(service.get({ ...user, role })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.save({ ...user, role }, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.user.findUnique).not.toHaveBeenCalled();
    expect(database.digitalMapDocument.findUnique).not.toHaveBeenCalled();
    expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
  });

  it.each([{ originalRole: 'PREVIEW' }, { isPreview: true }])(
    'blocks a preview identity rewritten to ADMIN: %p',
    async (preview) => {
      await expect(service.get({ ...user, ...preview })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.save({ ...user, ...preview }, input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...actor, isActive: false },
    { ...actor, role: 'MANAGER' },
    { ...actor, role: 'SALES' },
    { ...actor, role: 'PREVIEW' },
  ])(
    'rejects stale administrator tokens when the current account is %p',
    async (current) => {
      database.user.findUnique.mockResolvedValue(current);
      await expect(service.get(user)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.save(user, input)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(database.digitalMapDocument.findUnique).not.toHaveBeenCalled();
      expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
    },
  );

  it('allows a currently active administrator to read and save', async () => {
    await expect(service.get(user)).resolves.toMatchObject({
      canEdit: true,
    });
    await expect(service.save(user, input)).resolves.toMatchObject({
      version: 1,
    });
  });
});
