import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import type { PaymentActor } from './payment-tracking.types';
import { SalesLedgerService } from './sales-ledger.service';

@Controller('sales-ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SALES', 'ADMIN', 'MANAGER')
export class SalesLedgerController {
  constructor(private readonly ledger: SalesLedgerService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: { user: PaymentActor },
    @Query() query: Record<string, unknown>,
  ) {
    return this.ledger.list(req.user, query);
  }
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  export(
    @Req() req: { user: PaymentActor },
    @Query() query: Record<string, unknown>,
  ) {
    return this.ledger.list(req.user, query, true);
  }
  @Get(':key')
  @Header('Cache-Control', 'private, no-store')
  detail(@Req() req: { user: PaymentActor }, @Param('key') key: string) {
    return this.ledger.detail(req.user, key);
  }
  @Post(':key/actions')
  action(
    @Req() req: { user: PaymentActor },
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.ledger.action(req.user, key, body);
  }
  @Put(':key/followup-assignment')
  @Roles('ADMIN', 'MANAGER')
  assign(
    @Req() req: { user: PaymentActor },
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.ledger.assignFollowup(req.user, key, body);
  }
}
@Controller('sales-ledger-mappings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SalesLedgerMappingsController {
  constructor(private readonly ledger: SalesLedgerService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list() {
    return this.ledger.mappings();
  }
  @Put(':code')
  update(@Param('code') code: string, @Body() body: { userId: string | null }) {
    return this.ledger.setMapping(code, body?.userId);
  }
}
