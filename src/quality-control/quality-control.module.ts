import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { QualityControlController } from "./quality-control.controller";
import { QualityControlService } from "./quality-control.service";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [QualityControlController],
  providers: [QualityControlService],
})
export class QualityControlModule {}
