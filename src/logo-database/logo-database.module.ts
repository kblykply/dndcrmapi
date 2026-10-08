import { Module } from '@nestjs/common';
import { LogoConfigService } from './logo-config.service';
import { LogoDatabaseService } from './logo-database.service';

@Module({
  providers: [LogoConfigService, LogoDatabaseService],
  exports: [LogoConfigService, LogoDatabaseService],
})
export class LogoDatabaseModule {}
