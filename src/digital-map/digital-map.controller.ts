import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { DigitalMapValidationPipe } from './digital-map.dto';
import type { SaveDigitalMapDto } from './digital-map.dto';
import { DigitalMapGuard } from './digital-map.guard';
import type { DigitalMapUser } from './digital-map.guard';
import { DigitalMapService } from './digital-map.service';
import {
  DIGITAL_MAP_IMAGE_MAX_BYTES,
  DigitalMapImageService,
} from './digital-map-image.service';

@Controller('digital-map')
@UseGuards(JwtAuthGuard, DigitalMapGuard)
export class DigitalMapController {
  constructor(
    private readonly digitalMap: DigitalMapService,
    private readonly images: DigitalMapImageService,
  ) {}

  @Get()
  get(@Req() request: { user: DigitalMapUser }) {
    return this.digitalMap.get(request.user);
  }

  @Put()
  save(
    @Req() request: { user: DigitalMapUser },
    @Body(DigitalMapValidationPipe) body: SaveDigitalMapDto,
  ) {
    return this.digitalMap.save(request.user, body);
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DIGITAL_MAP_IMAGE_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadImage(
    @Req() request: { user: DigitalMapUser },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.images.upload(request.user, file);
  }

  @Get('images/:id')
  async image(
    @Req() request: { user: DigitalMapUser },
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.images.get(request.user, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(Buffer.from(image.content), {
      type: image.mimeType,
      length: image.size,
      disposition: 'inline',
    });
  }
}
