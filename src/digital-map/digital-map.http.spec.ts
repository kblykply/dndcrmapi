import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PreviewDataInterceptor } from '../common/preview-data.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { DigitalMapModule } from './digital-map.module';

describe('Digital map HTTP pipeline', () => {
  let app: INestApplication;
  const database = {
    user: { findUnique: jest.fn() },
    digitalMapDocument: { findUnique: jest.fn(), create: jest.fn() },
    digitalMapImage: { findUnique: jest.fn(), create: jest.fn() },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [DigitalMapModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = {
            id: 'test-user',
            role: req.headers['x-test-role'] ?? 'ADMIN',
          };
          return true;
        },
      })
      .useMocker((token) => (token === PrismaService ? database : undefined))
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new PreviewDataInterceptor());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    database.user.findUnique.mockResolvedValue({
      id: 'test-user',
      name: 'Test Admin',
      role: 'ADMIN',
      isActive: true,
    });
    database.digitalMapDocument.findUnique.mockResolvedValue(null);
    database.digitalMapDocument.create.mockImplementation(({ data }) => ({
      ...data,
      updatedAt: new Date('2026-09-15T10:00:00Z'),
    }));
    database.digitalMapImage.create.mockImplementation(({ data }) => ({
      id: 'image-1',
      name: data.name,
      mimeType: data.mimeType,
      size: data.size,
      createdAt: new Date('2026-09-15T14:00:00Z'),
    }));
    database.digitalMapImage.findUnique.mockResolvedValue({
      content: png,
      mimeType: 'image/png',
      size: png.length,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
    'base64',
  );

  it('uploads one screenshot via multipart without exposing its bytes in metadata', async () => {
    const response = await request(app.getHttpServer())
      .post('/digital-map/images')
      .attach('file', png, { filename: 'screen.png', contentType: 'image/png' })
      .expect(201);
    expect(response.body).toEqual({
      id: 'image-1',
      name: 'screen.png',
      mimeType: 'image/png',
      size: png.length,
      createdAt: '2026-09-15T14:00:00.000Z',
    });
  });

  it('serves the screenshot with private no-store cache and nosniff headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/digital-map/images/image-1')
      .expect(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toEqual(png);
  });

  it('rejects SVG content even when uploaded as PNG', async () => {
    const response = await request(app.getHttpServer())
      .post('/digital-map/images')
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'screen.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(response.body.code).toBe('DIGITAL_MAP_IMAGE_INVALID');
    expect(database.digitalMapImage.create).not.toHaveBeenCalled();
  });

  it('limits multipart upload size before persistence', async () => {
    await request(app.getHttpServer())
      .post('/digital-map/images')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(database.digitalMapImage.create).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'PREVIEW', 'SALES', 'ACCOUNTING'])(
    'rejects %s screenshot reads and uploads before image access',
    async (role) => {
      await request(app.getHttpServer())
        .get('/digital-map/images/image-1')
        .set('x-test-role', role)
        .expect(403);
      await request(app.getHttpServer())
        .post('/digital-map/images')
        .set('x-test-role', role)
        .attach('file', png, {
          filename: 'screen.png',
          contentType: 'image/png',
        })
        .expect(403);
      expect(database.digitalMapImage.create).not.toHaveBeenCalled();
      expect(database.digitalMapImage.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    { role: 'ADMIN', isActive: false },
    { role: 'MANAGER', isActive: true },
  ])(
    'denies all map and screenshot endpoints for a stale administrator token when the current account is %p',
    async (currentAccount) => {
      database.user.findUnique.mockResolvedValue({
        id: 'test-user',
        ...currentAccount,
      });
      await request(app.getHttpServer()).get('/digital-map').expect(403);
      await request(app.getHttpServer())
        .put('/digital-map')
        .send({ name: 'Map', nodes: [], edges: [], version: 0 })
        .expect(403);
      await request(app.getHttpServer())
        .get('/digital-map/images/image-1')
        .expect(403);
      await request(app.getHttpServer())
        .post('/digital-map/images')
        .attach('file', png, {
          filename: 'screen.png',
          contentType: 'image/png',
        })
        .expect(403);
      expect(database.digitalMapImage.create).not.toHaveBeenCalled();
      expect(database.digitalMapImage.findUnique).not.toHaveBeenCalled();
      expect(database.digitalMapDocument.findUnique).not.toHaveBeenCalled();
      expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
    },
  );

  it('returns the empty workspace through the real controller and global pipe', async () => {
    const response = await request(app.getHttpServer())
      .get('/digital-map')
      .expect(200);
    expect(response.body).toEqual({
      id: 'dnd-digital-map',
      name: 'DND Dijital Harita',
      nodes: [],
      edges: [],
      version: 0,
      updatedAt: null,
      updatedByName: null,
      canEdit: true,
    });
  });

  it('keeps the DTO through global whitelisting and saves only known fields', async () => {
    const response = await request(app.getHttpServer())
      .put('/digital-map')
      .send({
        name: 'Map',
        nodes: [],
        edges: [],
        version: 0,
        updatedByName: 'Spoofed',
      })
      .expect(200);
    expect(response.body).toMatchObject({
      name: 'Map',
      version: 1,
      updatedByName: 'Test Admin',
    });
    expect(database.digitalMapDocument.create).toHaveBeenCalledWith({
      data: {
        id: 'dnd-digital-map',
        name: 'Map',
        nodes: [],
        edges: [],
        version: 1,
        updatedByName: 'Test Admin',
        updatedById: 'test-user',
      },
    });
  });

  it('returns the module validation error code over HTTP', async () => {
    const response = await request(app.getHttpServer())
      .put('/digital-map')
      .send({
        name: 'Map',
        nodes: [{ kind: 'UNKNOWN' }],
        edges: [],
        version: 0,
      })
      .expect(400);
    expect(response.body).toEqual({
      code: 'DIGITAL_MAP_INVALID',
      message: expect.any(String),
    });
    expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'PREVIEW', 'SALES', 'ACCOUNTING'])(
    'rejects %s before the preview interceptor can rewrite its role',
    async (role) => {
      await request(app.getHttpServer())
        .get('/digital-map')
        .set('x-test-role', role)
        .expect(403);
      await request(app.getHttpServer())
        .put('/digital-map')
        .set('x-test-role', role)
        .send({ name: 'Map', nodes: [], edges: [], version: 0 })
        .expect(403);
      expect(database.user.findUnique).not.toHaveBeenCalled();
      expect(database.digitalMapDocument.findUnique).not.toHaveBeenCalled();
      expect(database.digitalMapDocument.create).not.toHaveBeenCalled();
    },
  );
});
