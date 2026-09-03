import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentWheelController } from './agent-wheel.controller';
import { AgentWheelService } from './agent-wheel.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgentWheelController],
  providers: [AgentWheelService],
})
export class AgentWheelModule {}
