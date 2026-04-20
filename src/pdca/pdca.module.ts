import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { PdcaController } from "./pdca.controller";
import { PdcaService } from "./pdca.service";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [PdcaController],
  providers: [PdcaService],
  exports: [PdcaService],
})
export class PdcaModule {}