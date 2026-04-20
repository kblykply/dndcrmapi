import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OrgChartController } from "./org-chart.controller";
import { OrgChartService } from "./org-chart.service";

@Module({
  imports: [PrismaModule],
  controllers: [OrgChartController],
  providers: [OrgChartService],
  exports: [OrgChartService],
})
export class OrgChartModule {}