import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ConstructionGuard, type ConstructionUser } from './construction.guard';
import { ConstructionService } from './construction.service';
type Request = { user: ConstructionUser };
@Controller('construction')
@UseGuards(JwtAuthGuard, ConstructionGuard)
export class ConstructionController {
  constructor(private readonly service: ConstructionService) {}
  @Get('workspace') workspace(@Req() r: Request) {
    return this.service.workspace(r.user);
  }
  @Get('projects/:id') project(@Param('id') id: string, @Req() r: Request) {
    return this.service.project(id, r.user);
  }
  @Get('projects/:id/history') history(
    @Param('id') id: string,
    @Req() r: Request,
    @Query('cursor') cursor?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.service.history(id, r.user, cursor, entityId);
  }
  @Get('units/:id') unit(@Param('id') id: string, @Req() r: Request) {
    return this.service.unit(id, r.user);
  }
  @Patch('units/:unitId/entries/:id') entry(
    @Param('unitId') unitId: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.updateEntry(unitId, id, b, r.user);
  }
  @Get('claims/:id') claim(@Param('id') id: string, @Req() r: Request) {
    return this.service.claim(id, r.user);
  }
  @Patch('claims/:id') claimUpdate(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.updateClaim(id, b, r.user);
  }
  @Post('claims/:id/next-period') next(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.createClaim(id, b, r.user);
  }
  @Patch('claims/:claimId/lines/:id') line(
    @Param('claimId') claimId: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.updateClaimLine(claimId, id, b, r.user);
  }
  @Get('budgets/:id') budget(@Param('id') id: string, @Req() r: Request) {
    return this.service.budget(id, r.user);
  }
  @Patch('budgets/:budgetId/items/:id') item(
    @Param('budgetId') budgetId: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.updateBudgetItem(budgetId, id, b, r.user);
  }
  @Patch('issues/:id') issue(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.updateIssue(id, b, r.user);
  }
}
