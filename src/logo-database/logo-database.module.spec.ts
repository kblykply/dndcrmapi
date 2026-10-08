import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LogoConfigService } from './logo-config.service';
import { LogoDatabaseModule } from './logo-database.module';
import { LogoDatabaseService } from './logo-database.service';

@Injectable()
class DirectDatabaseConsumer {
  constructor(
    readonly database: LogoDatabaseService,
    readonly config: LogoConfigService,
  ) {}
}

@Module({
  imports: [LogoDatabaseModule],
  providers: [DirectDatabaseConsumer],
  exports: [DirectDatabaseConsumer],
})
class DirectConsumerModule {}

@Injectable()
class AnotherDatabaseConsumer {
  constructor(
    readonly database: LogoDatabaseService,
    readonly config: LogoConfigService,
  ) {}
}

@Module({
  imports: [LogoDatabaseModule],
  providers: [AnotherDatabaseConsumer],
  exports: [AnotherDatabaseConsumer],
})
class AnotherConsumerModule {}

describe('LogoDatabaseModule', () => {
  it('shares one database provider across independent consumer modules', async () => {
    const testing = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DirectConsumerModule,
        AnotherConsumerModule,
      ],
    }).compile();

    try {
      const direct = testing.get(DirectDatabaseConsumer);
      const another = testing.get(AnotherDatabaseConsumer);
      expect(direct.database).toBe(another.database);
      expect(direct.config).toBe(another.config);
    } finally {
      await testing.close();
    }
  });
});
