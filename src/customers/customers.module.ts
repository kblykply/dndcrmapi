import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { PresentationsController } from "../presentations/presentations.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [CustomersController, PresentationsController],
  providers: [CustomersService],
})
export class CustomersModule {}
