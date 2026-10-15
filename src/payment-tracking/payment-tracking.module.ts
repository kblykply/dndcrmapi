import {
  SalesLedgerController,
  SalesLedgerMappingsController,
} from './sales-ledger.controller';
import { SalesLedgerService } from './sales-ledger.service';
import { PaymentInstallmentTableController } from './payment-installment-table.controller';
import { PaymentSnapshotDatabaseService } from './payment-snapshot-database.service';
import { LogoDatabaseService } from '../logo-database/logo-database.service';
import { Module } from '@nestjs/common';
import { LogoDatabaseModule } from '../logo-database/logo-database.module';
import { PaymentTrackingCatalogService } from './payment-tracking-catalog.service';
import { PaymentTrackingController } from './payment-tracking.controller';
import { PaymentTrackingService } from './payment-tracking.service';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import { PaymentCollectionReportController } from './payment-collection-report.controller';
import { PaymentCollectionReportService } from './payment-collection-report.service';

@Module({
  imports: [LogoDatabaseModule],
  controllers: [
    SalesLedgerController,
    SalesLedgerMappingsController,
    PaymentTrackingController,
    PaymentCollectionReportController,
    PaymentInstallmentTableController,
  ],
  providers: [
    { provide: LogoDatabaseService, useClass: PaymentSnapshotDatabaseService },
    SalesLedgerService,
    PaymentTrackingService,
    PaymentTrackingSourceService,
    PaymentTrackingStoreService,
    PaymentTrackingCatalogService,
    PaymentCollectionReportService,
  ],
  exports: [PaymentTrackingSourceService],
})
export class PaymentTrackingModule {}
