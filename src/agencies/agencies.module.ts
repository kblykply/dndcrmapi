import { Module } from "@nestjs/common";
import { AgenciesController } from "./agencies.controller";
import { AgenciesService } from "./agencies.service";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [AgenciesController],
  providers: [AgenciesService],
})
export class AgenciesModule {}
