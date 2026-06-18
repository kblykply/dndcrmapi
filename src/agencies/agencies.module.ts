import { Module } from "@nestjs/common";
import { AgenciesController } from "./agencies.controller";
import { AgenciesService } from "./agencies.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [AgenciesController],
  providers: [AgenciesService, PrismaService],
})
export class AgenciesModule {}
