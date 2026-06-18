import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  providers: [LeadsService],
  controllers: [LeadsController],
})
export class LeadsModule {}
