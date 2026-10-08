import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { DigitalTeamGuard } from './digital-team.guard';
import type { DigitalTeamUser } from './digital-team.guard';
import { DigitalTeamService } from './digital-team.service';

type Request = { user: DigitalTeamUser };

@Controller('digital-team')
@UseGuards(JwtAuthGuard, DigitalTeamGuard)
export class DigitalTeamController {
  constructor(private readonly team: DigitalTeamService) {}

  @Get('workspace') workspace(@Req() request: Request) {
    return this.team.workspace(request.user);
  }
  @Post('members') createMember(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    return this.team.createMember(request.user, body);
  }
  @Put('members/:id') updateMember(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.team.updateMember(request.user, id, body);
  }
  @Post('projects') createProject(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    return this.team.createProject(request.user, body);
  }
  @Get('projects/:id') project(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.team.getProject(request.user, id);
  }
  @Put('projects/:id') updateProject(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.team.updateProject(request.user, id, body);
  }
  @Post('projects/:id/updates') addUpdate(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.team.addUpdate(request.user, id, body);
  }
  @Get('projects/:id/updates') updates(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.team.updates(request.user, id, cursor);
  }
}
