import { Module } from '@nestjs/common';
import { DigitalTeamController } from './digital-team.controller';
import { DigitalTeamGuard } from './digital-team.guard';
import { DigitalTeamService } from './digital-team.service';

@Module({
  controllers: [DigitalTeamController],
  providers: [DigitalTeamService, DigitalTeamGuard],
})
export class DigitalTeamModule {}
