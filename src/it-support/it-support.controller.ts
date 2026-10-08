import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ItSupportGuard } from './it-support.guard';
import type { ItUser } from './it-support.guard';
import { ItSupportService } from './it-support.service';
import { FILE_LIMIT } from './it-support.dto';
type Request = { user: ItUser };
const upload = FilesInterceptor('files', 3, {
  storage: memoryStorage(),
  limits: {
    // Busboy emits its size limit at equality; the DTO enforces <= FILE_LIMIT.
    fileSize: FILE_LIMIT + 1,
    files: 3,
    fields: 1,
    fieldSize: 100 * 1024,
    parts: 5,
  },
});
@Controller('it-support')
@UseGuards(JwtAuthGuard, ItSupportGuard)
export class ItSupportController {
  constructor(private readonly support: ItSupportService) {}
  @Get('workspace') workspace(@Req() req: Request) {
    return this.support.workspace(req.user);
  }
  @Get('tickets') list(
    @Req() req: Request,
    @Query() query: Record<string, unknown>,
  ) {
    return this.support.list(req.user, query);
  }
  @Post('tickets') @UseInterceptors(upload) create(
    @Req() req: Request,
    @Body() body: unknown,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.support.create(req.user, body, files);
  }
  @Get('tickets/:id') get(@Req() req: Request, @Param('id') id: string) {
    return this.support.get(req.user, id);
  }
  @Get('tickets/:id/entries') entries(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.support.entries(req.user, id, cursor);
  }
  @Post('tickets/:id/entries') @UseInterceptors(upload) reply(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.support.reply(req.user, id, body, files);
  }
  @Post('tickets/:id/actions') action(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.support.action(req.user, id, body);
  }
  @Put('tickets/:id/triage') triage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.support.triage(req.user, id, body);
  }
  @Get('attachments/:id') async file(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.support.attachment(req.user, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const filename = encodeURIComponent(file.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new StreamableFile(Buffer.from(file.content), {
      type: file.mimeType,
      length: file.size,
      disposition: `attachment; filename*=UTF-8''${filename}`,
    });
  }
}
