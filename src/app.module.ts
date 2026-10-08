import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { TasksModule } from './tasks/tasks.module';
import { MetaModule } from './integrations/meta/meta.module';
import { HealthController } from './health.controller';
import { AdminModule } from './admin/admin.module';
import { AgenciesModule } from './agencies/agencies.module';
import { CustomersModule } from './customers/customers.module';
import { CalendarModule } from './calendar/calendar.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MeetingsModule } from './meetings/meetings.module';

import { PdcaModule } from './pdca/pdca.module';

import { OrgChartModule } from './org-chart/org-chart.module';
import { UserActivityModule } from './user-activity/user-activity.module';
import { UnitsModule } from './units/units.module';
import { QualityControlModule } from './quality-control/quality-control.module';
import { Iso2026Module } from './iso-2026/iso-2026.module';
import { BulkEmailModule } from './bulk-email/bulk-email.module';
import { AgentWheelModule } from './agent-wheel/agent-wheel.module';
import { DigitalMapModule } from './digital-map/digital-map.module';
import { DigitalTeamModule } from './digital-team/digital-team.module';
import { ItSupportModule } from './it-support/it-support.module';
import { PaymentTrackingModule } from './payment-tracking/payment-tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
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
    OrgChartModule,
    PdcaModule,
    UserActivityModule,
    UnitsModule,
    QualityControlModule,
    Iso2026Module,
    BulkEmailModule,
    AgentWheelModule,
    DigitalMapModule,
    DigitalTeamModule,
    ItSupportModule,
    PaymentTrackingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
