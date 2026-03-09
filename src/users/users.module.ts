import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { FilesModule } from "../files/files.module";
import { UsersController } from "./users.controller";
import { UsersMeController } from "./users.me.controller";

@Module({
  imports: [PrismaModule, FilesModule],
  controllers: [UsersController, UsersMeController],
})
export class UsersModule {}