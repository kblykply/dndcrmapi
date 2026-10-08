import { Module } from '@nestjs/common';
import { ItSupportController } from './it-support.controller';
import { ItSupportGuard } from './it-support.guard';
import { ItSupportService } from './it-support.service';
@Module({
  controllers: [ItSupportController],
  providers: [ItSupportService, ItSupportGuard],
})
export class ItSupportModule {}
