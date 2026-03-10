import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "path";

import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { LeadsModule } from "./leads/leads.module";
import { TasksModule } from "./tasks/tasks.module";
import { MetaModule } from "./integrations/meta/meta.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), ".env"),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    TasksModule,
    MetaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}