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
import { AdminModule } from "./admin/admin.module";
import { AgenciesModule } from "./agencies/agencies.module";
import { CustomersModule } from "./customers/customers.module";
import { CalendarModule } from "./calendar/calendar.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { MeetingsModule } from "./meetings/meetings.module";




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
    AdminModule,
    AgenciesModule,
    CustomersModule,
    CalendarModule,
    NotificationsModule,
        MeetingsModule,

        

  ],
  controllers: [HealthController],
})
export class AppModule {}