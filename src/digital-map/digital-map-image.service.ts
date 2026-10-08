import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DigitalMapUser } from './digital-map.guard';
import { DigitalMapService } from './digital-map.service';

export const DIGITAL_MAP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function invalidImage(message: string): never {
  throw new BadRequestException({ code: 'DIGITAL_MAP_IMAGE_INVALID', message });
}

/** Detect supported raster formats from bytes, never from the extension alone. */
export function detectImageMime(
  buffer: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    buffer.length >= 33 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.readUInt32BE(8) === 13 &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.readUInt32LE(4) + 8 === buffer.length &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class DigitalMapImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly digitalMap: DigitalMapService,
  ) {}

  async upload(user: DigitalMapUser, file?: Express.Multer.File) {
    const actor = await this.digitalMap.authorize(user);
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
      invalidImage('Choose a PNG, JPEG or WebP image.');
    }
    if (file.buffer.length > DIGITAL_MAP_IMAGE_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'DIGITAL_MAP_IMAGE_TOO_LARGE',
        message: 'Map images must be at most 5 MiB.',
      });
    }
    const mimeType = detectImageMime(file.buffer);
    if (!mimeType || mimeType !== file.mimetype) {
      invalidImage(
        'The file contents must match its PNG, JPEG or WebP image type. SVG and other file types are not supported.',
      );
    }
    const name =
      (file.originalname.split(/[\\/]/).pop() ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 240) || 'Map image';
    const image = await this.prisma.digitalMapImage.create({
      data: {
        name,
        mimeType,
        size: file.buffer.length,
        content: file.buffer,
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
    return { ...image, createdAt: image.createdAt.toISOString() };
  }

  async get(user: DigitalMapUser, id: string) {
    await this.digitalMap.authorize(user);
    if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(id)) {
      throw new NotFoundException('Map image not found.');
    }
    const image = await this.prisma.digitalMapImage.findUnique({
      where: { id },
      select: { content: true, mimeType: true, size: true },
    });
    if (!image) throw new NotFoundException('Map image not found.');
    return image as { content: Uint8Array; mimeType: string; size: number };
  }
}
