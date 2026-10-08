import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Header,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PaymentTrackingGuard } from './payment-tracking.guard';
import { PaymentTrackingService } from './payment-tracking.service';
import type { PaymentActor } from './payment-tracking.types';

@Controller('payment-tracking')
@UseGuards(JwtAuthGuard, PaymentTrackingGuard)
export class PaymentTrackingController {
  constructor(private readonly payments: PaymentTrackingService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: { user: PaymentActor },
    @Query() query: Record<string, unknown>,
  ) {
    return this.payments.list(req.user, query);
  }
  @Get(':key')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @Param('key') key: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.payments.detail(key, query);
  }
  @Post(':key/actions')
  action(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: { user: PaymentActor },
  ) {
    return this.payments.action(key, body, req.user);
  }
}
