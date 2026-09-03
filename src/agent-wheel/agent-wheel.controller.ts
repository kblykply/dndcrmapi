import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AgentWheelService } from './agent-wheel.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agent-wheel')
export class AgentWheelController {
  constructor(private readonly agentWheel: AgentWheelService) {}

  @Get('options')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  options(@Req() req: any) {
    return this.agentWheel.getOptions(req.user);
  }

  @Post('spins')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  spin(
    @Req() req: any,
    @Body()
    body: {
      customerId?: string | null;
      unitSelectionId?: string | null;
      agencyId?: string | null;
    },
  ) {
    return this.agentWheel.spin(req.user, body);
  }

  @Get('spins')
  @Roles('ADMIN', 'MANAGER')
  spins(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('spunById') spunById?: string,
    @Query('agencyId') agencyId?: string,
    @Query('saleType') saleType?: string,
    @Query('project') project?: string,
    @Query('prizeId') prizeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.agentWheel.listSpins(req.user, {
      q,
      spunById,
      agencyId,
      saleType,
      project,
      prizeId,
      dateFrom,
      dateTo,
      page,
      pageSize,
    });
  }

  @Get('management-options')
  @Roles('ADMIN', 'MANAGER')
  managementOptions(@Req() req: any) {
    return this.agentWheel.getManagementOptions(req.user);
  }
}
