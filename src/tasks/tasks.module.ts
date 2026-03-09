import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [TasksService],
  controllers: [TasksController],
})
export class TasksModule {}