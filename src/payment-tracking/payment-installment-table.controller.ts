import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PaymentTrackingGuard } from './payment-tracking.guard';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import { buildInstallmentTable } from './payment-installment-table';

@Controller('payment-installment-table')
@UseGuards(JwtAuthGuard, PaymentTrackingGuard)
export class PaymentInstallmentTableController {
  constructor(private readonly source: PaymentTrackingSourceService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Query() query: Record<string, unknown> = {}) {
    return buildInstallmentTable(
      await this.source.snapshot(query.refresh === 'true'),
      query,
    );
  }
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query() query: Record<string, unknown> = {}) {
    return buildInstallmentTable(
      await this.source.snapshot(query.refresh === 'true'),
      query,
      { allRows: true },
    );
  }
}
