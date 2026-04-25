import { Module } from "@nestjs/common";
import { UserActivityController } from "./user-activity.controller";
import { UserActivityService } from "./user-activity.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [UserActivityController],
  providers: [UserActivityService],
})
export class UserActivityModule {}