import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { TasksService, WorkUser } from './tasks.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import {
  ArchiveDto,
  BulkTaskDto,
  ChecklistDto,
  CommentDto,
  CreateTaskDto,
  DependencyDto,
  ProjectDto,
  TaskQueryDto,
  TimeEntryDto,
  UpdateProjectDto,
  UpdateTaskDto,
  VersionDto,
  WatchDto,
} from './tasks.dto';
type Request = { user: WorkUser };

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get('workspace') workspace(@Req() req: Request) {
    return this.tasks.workspace(req.user);
  }
  @Get('report') report(@Req() req: Request, @Query() query: TaskQueryDto) {
    return this.tasks.report(req.user, query);
  }
  @Get('references/:kind') references(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('search') search = '',
  ) {
    return this.tasks.references(req.user, kind, search);
  }
  @Get('my') my(@Req() req: Request, @Query() query: TaskQueryDto) {
    return this.tasks.listMy(req.user, query);
  }
  @Get('team') team(@Req() req: Request, @Query() query: TaskQueryDto) {
    return this.tasks.listTeam(req.user, query);
  }
  @Get() list(@Req() req: Request, @Query() query: TaskQueryDto) {
    return this.tasks.listAll(req.user, query);
  }
  @Post('projects') createProject(
    @Req() req: Request,
    @Body() dto: ProjectDto,
  ) {
    return this.tasks.createProject(req.user, dto);
  }
  @Patch('projects/:id') updateProject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.tasks.updateProject(req.user, id, dto);
  }
  @Post('projects/:id/archive') archiveProject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.tasks.archiveProject(req.user, id, dto);
  }
  @Post('bulk') bulk(@Req() req: Request, @Body() dto: BulkTaskDto) {
    return this.tasks.bulk(req.user, dto);
  }
  @Post() create(@Req() req: Request, @Body() dto: CreateTaskDto) {
    return this.tasks.create(req.user, dto);
  }
  @Get(':id/history') history(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.history(req.user, id, query.skip);
  }
  @Get(':id') detail(@Req() req: Request, @Param('id') id: string) {
    return this.tasks.getOne(req.user, id);
  }
  @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(req.user, id, dto);
  }
  @Patch(':id/done') done(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.update(req.user, id, { ...dto, status: 'DONE' });
  }
  @Patch(':id/cancel') cancel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.update(req.user, id, { ...dto, status: 'CANCELLED' });
  }
  @Post(':id/archive') archive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.tasks.archive(req.user, id, dto);
  }
  @Delete(':id') remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.archive(req.user, id, { ...dto, archived: true });
  }
  @Post(':id/watch') watch(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: WatchDto,
  ) {
    return this.tasks.watch(req.user, id, dto.watching);
  }
  @Post(':id/comments') comment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    return this.tasks.comment(req.user, id, dto);
  }
  @Patch(':id/comments/:entryId') editComment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: CommentDto,
  ) {
    return this.tasks.comment(req.user, id, dto, entryId);
  }
  @Post(':id/checklist') checklist(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ChecklistDto,
  ) {
    return this.tasks.checklist(req.user, id, dto);
  }
  @Patch(':id/checklist/:entryId') editChecklist(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: ChecklistDto,
  ) {
    return this.tasks.checklist(req.user, id, dto, entryId);
  }
  @Post(':id/time') time(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: TimeEntryDto,
  ) {
    return this.tasks.time(req.user, id, dto);
  }
  @Patch(':id/time/:entryId') editTime(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: TimeEntryDto,
  ) {
    return this.tasks.time(req.user, id, dto, entryId);
  }
  @Post(':id/dependencies') dependency(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DependencyDto,
  ) {
    return this.tasks.dependency(req.user, id, dto);
  }
  @Post(':id/files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('version', ParseIntPipe) version: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.tasks.upload(req.user, id, version, file);
  }
  @Get(':id/files/:fileId')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.tasks.download(req.user, id, fileId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(Buffer.from(file.content), {
      type: 'application/octet-stream',
      disposition:
        "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      length: file.size,
    });
  }
  @Delete(':id/comments/:entryId') removeComment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.removePart(
      req.user,
      id,
      'comments',
      entryId,
      dto.version,
    );
  }
  @Delete(':id/checklist/:entryId') removeChecklist(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.removePart(
      req.user,
      id,
      'checklist',
      entryId,
      dto.version,
    );
  }
  @Delete(':id/time/:entryId') removeTime(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.removePart(req.user, id, 'time', entryId, dto.version);
  }
  @Delete(':id/files/:entryId') removeFile(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.removePart(req.user, id, 'files', entryId, dto.version);
  }
  @Delete(':id/dependencies/:entryId') removeDependency(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: VersionDto,
  ) {
    return this.tasks.removePart(
      req.user,
      id,
      'dependencies',
      entryId,
      dto.version,
    );
  }
}
