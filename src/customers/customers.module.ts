import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { PresentationsController } from "../presentations/presentations.controller";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [CustomersController, PresentationsController],
  providers: [CustomersService, PrismaService],
})
export class CustomersModule {}
