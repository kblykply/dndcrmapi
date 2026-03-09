import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(user: { id: string; role: string; email: string }, action: string, entityType: string, entityId: string, metaJson?: any) {
    return this.prisma.auditLog.create({
      data: {
        actorId: user?.id,
        action,
        entityType,
        entityId,
        metaJson,
      },
    });
  }
}