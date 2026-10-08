import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ISO_READ_ROLES, ISO_WRITE_ROLES } from './iso-2026.dto';
import type { IsoUser } from './iso-2026.dto';
import { Iso2026Service } from './iso-2026.service';
type Request = { user: IsoUser };

@Controller('iso-2026')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Iso2026Controller {
  constructor(private readonly iso: Iso2026Service) {}

  @Get()
  @Roles(...ISO_READ_ROLES)
  list(@Req() req: Request) { return this.iso.list(req.user); }

  @Get('source/pdf')
  @Roles(...ISO_READ_ROLES)
  async pdf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const content = await this.iso.sourcePdf(req.user);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(content, { type: 'application/pdf', length: content.length, disposition: 'inline; filename="ISO_9001_2026.pdf"' });
  }

  @Get(':code')
  @Roles(...ISO_READ_ROLES)
  get(@Req() req: Request, @Param('code') code: string) { return this.iso.get(req.user, code); }

  @Patch(':code')
  @Roles(...ISO_WRITE_ROLES)
  update(@Req() req: Request, @Param('code') code: string, @Body() body: unknown) { return this.iso.updateCard(req.user, code, body); }

  @Post(':code/checklists')
  @Roles(...ISO_WRITE_ROLES)
  createChecklist(@Req() req: Request, @Param('code') code: string, @Body() body: unknown) { return this.iso.createChecklist(req.user, code, body); }

  @Patch(':code/checklists/:itemId')
  @Roles(...ISO_WRITE_ROLES)
  updateChecklist(@Req() req: Request, @Param('code') code: string, @Param('itemId') itemId: string, @Body() body: unknown) { return this.iso.updateChecklist(req.user, code, itemId, body); }

  @Delete(':code/checklists/:itemId')
  @Roles(...ISO_WRITE_ROLES)
  deleteChecklist(@Req() req: Request, @Param('code') code: string, @Param('itemId') itemId: string) { return this.iso.deleteChecklist(req.user, code, itemId); }

  @Post(':code/documents')
  @Roles(...ISO_WRITE_ROLES)
  createDocument(@Req() req: Request, @Param('code') code: string, @Body() body: unknown) { return this.iso.createDocument(req.user, code, body); }

  @Patch(':code/documents/:documentId')
  @Roles(...ISO_WRITE_ROLES)
  updateDocument(@Req() req: Request, @Param('code') code: string, @Param('documentId') id: string, @Body() body: unknown) { return this.iso.updateDocument(req.user, code, id, body); }

  @Delete(':code/documents/:documentId')
  @Roles(...ISO_WRITE_ROLES)
  deleteDocument(@Req() req: Request, @Param('code') code: string, @Param('documentId') id: string) { return this.iso.deleteDocument(req.user, code, id); }

  @Post(':code/logs')
  @Roles(...ISO_WRITE_ROLES)
  addLog(@Req() req: Request, @Param('code') code: string, @Body() body: unknown) { return this.iso.addLog(req.user, code, body); }
}
