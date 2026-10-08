import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { DigitalMapService } from './digital-map.service';
import {
  DIGITAL_MAP_IMAGE_MAX_BYTES,
  DigitalMapImageService,
  detectImageMime,
} from './digital-map-image.service';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  'base64',
);
const user = { id: 'admin', role: 'ADMIN' };
const actor = {
  id: 'admin',
  name: 'Actual Admin',
  role: 'ADMIN',
  isActive: true,
};
const file = (buffer = png, mimeType = 'image/png', name = 'screen.png') =>
  ({
    buffer,
    mimetype: mimeType,
    originalname: name,
    size: buffer.length,
  }) as Express.Multer.File;

describe('DigitalMapImageService', () => {
  const database = {
    user: { findUnique: jest.fn() },
    digitalMapImage: { create: jest.fn(), findUnique: jest.fn() },
  };
  let service: DigitalMapImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    database.user.findUnique.mockResolvedValue(actor);
    database.digitalMapImage.create.mockResolvedValue({
      id: 'image-1',
      name: 'screen.png',
      mimeType: 'image/png',
      size: png.length,
      createdAt: new Date('2026-09-15T14:00:00Z'),
    });
    database.digitalMapImage.findUnique.mockResolvedValue({
      content: png,
      mimeType: 'image/png',
      size: png.length,
    });
    const prisma = database as unknown as PrismaService;
    service = new DigitalMapImageService(prisma, new DigitalMapService(prisma));
  });

  it('stores image bytes privately with actual uploader snapshots and returns only metadata', async () => {
    await expect(service.upload(user, file())).resolves.toEqual({
      id: 'image-1',
      name: 'screen.png',
      mimeType: 'image/png',
      size: png.length,
      createdAt: '2026-09-15T14:00:00.000Z',
    });
    expect(database.digitalMapImage.create).toHaveBeenCalledWith({
      data: {
        name: 'screen.png',
        mimeType: 'image/png',
        size: png.length,
        content: png,
        createdById: actor.id,
        createdByName: actor.name,
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });
  });

  it('sanitizes file metadata and calculates size from the actual buffer', async () => {
    await service.upload(user, {
      ...file(png, 'image/png', '..\\..\\screen\u0000.png'),
      size: 1,
    });
    expect(database.digitalMapImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'screen.png', size: png.length }),
      }),
    );
  });

  it.each([
    undefined,
    file(Buffer.alloc(0)),
    file(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml'),
    file(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/png'),
    file(png, 'image/jpeg'),
    file(Buffer.from([137, 80, 78, 71]), 'image/png'),
  ])(
    'rejects missing, empty, spoofed, truncated or unsupported input',
    async (input) => {
      await expect(service.upload(user, input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.digitalMapImage.create).not.toHaveBeenCalled();
    },
  );

  it('enforces the size bound even on direct service calls with a spoofed size', async () => {
    await expect(
      service.upload(user, {
        ...file(Buffer.alloc(DIGITAL_MAP_IMAGE_MAX_BYTES + 1)),
        size: 1,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(database.digitalMapImage.create).not.toHaveBeenCalled();
  });

  it('serves stored image bytes only after a fresh active account check', async () => {
    await expect(service.get(user, 'image-1')).resolves.toEqual({
      content: png,
      mimeType: 'image/png',
      size: png.length,
    });
    expect(database.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...user, role: 'MANAGER' },
    { ...user, role: 'PREVIEW' },
    { ...user, originalRole: 'PREVIEW' },
    { ...user, isPreview: true },
    { ...user, role: 'SALES' },
  ])('rejects unauthorized image read and upload %p', async (identity) => {
    await expect(service.upload(identity, file())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.get(identity, 'image-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.digitalMapImage.create).not.toHaveBeenCalled();
    expect(database.digitalMapImage.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...actor, role: 'MANAGER' },
    { ...actor, role: 'SALES' },
    { ...actor, isActive: false },
  ])(
    'rejects stale privileged tokens when the current account is %p',
    async (current) => {
      database.user.findUnique.mockResolvedValue(current);
      await expect(service.upload(user, file())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.get(user, 'image-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(database.digitalMapImage.create).not.toHaveBeenCalled();
      expect(database.digitalMapImage.findUnique).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for an unknown image', async () => {
    database.digitalMapImage.findUnique.mockResolvedValue(null);
    await expect(service.get(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 404 for a malformed image ID without a database image lookup', async () => {
    await expect(service.get(user, '../invalid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(database.digitalMapImage.findUnique).not.toHaveBeenCalled();
  });
});

describe('raster signatures', () => {
  it('recognizes PNG, JPEG and WebP signatures', () => {
    expect(detectImageMime(png)).toBe('image/png');
    expect(
      detectImageMime(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
      ),
    ).toBe('image/jpeg');
    const webp = Buffer.alloc(24);
    webp.write('RIFF', 0);
    webp.writeUInt32LE(16, 4);
    webp.write('WEBPVP8 ', 8);
    expect(detectImageMime(webp)).toBe('image/webp');
    webp.writeUInt32LE(100, 4);
    expect(detectImageMime(webp)).toBeNull();
  });
});
