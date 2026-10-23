import { Module } from '@nestjs/common';
import { ConstructionController } from './construction.controller';
import { ConstructionService } from './construction.service';
import { ConstructionGuard } from './construction.guard';
@Module({
  controllers: [ConstructionController],
  providers: [ConstructionService, ConstructionGuard],
})
export class ConstructionModule {}
