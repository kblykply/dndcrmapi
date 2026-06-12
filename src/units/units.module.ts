import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailModule } from "../email/email.module";
import { UnitsController } from "./units.controller";
import { UnitsService } from "./units.service";

@Module({
  imports: [PrismaModule, NotificationsModule, EmailModule],
  controllers: [UnitsController],
  providers: [UnitsService],
})
export class UnitsModule {}
