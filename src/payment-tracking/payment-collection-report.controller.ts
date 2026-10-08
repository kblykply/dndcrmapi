import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PaymentTrackingGuard } from './payment-tracking.guard';
import { PaymentCollectionReportService } from './payment-collection-report.service';

@Controller('payment-collection-report')
@UseGuards(JwtAuthGuard, PaymentTrackingGuard)
export class PaymentCollectionReportController {
  constructor(private readonly reportService: PaymentCollectionReportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: Record<string, unknown> = {}) {
    return this.reportService.report(query);
  }
}
