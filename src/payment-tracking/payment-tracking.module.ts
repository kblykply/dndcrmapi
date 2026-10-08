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
  controllers: [PaymentTrackingController, PaymentCollectionReportController],
  providers: [
    { provide: LogoDatabaseService, useClass: PaymentSnapshotDatabaseService },
    PaymentTrackingService,
    PaymentTrackingSourceService,
    PaymentTrackingStoreService,
    PaymentTrackingCatalogService,
    PaymentCollectionReportService,
  ],
  exports: [PaymentTrackingSourceService],
})
export class PaymentTrackingModule {}
