import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { Iso2026Controller } from './iso-2026.controller';
import { Iso2026Service } from './iso-2026.service';
import { Iso2026Source } from './iso-2026.catalog';

@Module({
  imports: [PrismaModule],
  controllers: [Iso2026Controller],
  providers: [Iso2026Service, Iso2026Source],
})
export class Iso2026Module {}
