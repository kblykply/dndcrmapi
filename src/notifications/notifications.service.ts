import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsGateway } from "./notifications.gateway";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type CreateNotificationInput = {
  userId: string;
  type:
    | "TASK_ASSIGNED"
    | "TASK_UPDATED"
    | "TASK_DUE"
    | "TASK_OVERDUE"
    | "LEAD_ASSIGNED"
    | "LEAD_STATUS_CHANGED"
    | "LEAD_SENT_TO_MANAGER"
    | "AGENCY_UPDATED"
    | "CUSTOMER_UPDATED"
    | "PRESENTATION_CREATED"
    | "PRESENTATION_NOTE_ADDED"
    | "SYSTEM";
  title: string;
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  metaJson?: any;
};

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) {
      throw new ForbiddenException("Unauthorized");
    }
  }

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || null;
  }

  private async pushUnreadCount(userId: string) {
    const unread = await this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });

    this.gateway.emitUnreadCount(userId, unread);
  }

  async createForUser(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.trim(),
        message: this.cleanStr(input.message),
        entityType: this.cleanStr(input.entityType),
        entityId: this.cleanStr(input.entityId),
        link: this.cleanStr(input.link),
        metaJson: input.metaJson ?? null,
      },
    });

    this.gateway.emitNotificationToUser(input.userId, notification);
    await this.pushUnreadCount(input.userId);

    return notification;
  }

  async createManyForUsers(
    userIds: string[],
    input: Omit<CreateNotificationInput, "userId">,
  ) {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    if (uniqueUserIds.length === 0) {
      return { count: 0, items: [] };
    }

    const created = await this.prisma.$transaction(
      uniqueUserIds.map((userId) =>
        this.prisma.notification.create({
          data: {
            userId,
            type: input.type,
            title: input.title.trim(),
            message: this.cleanStr(input.message),
            entityType: this.cleanStr(input.entityType),
            entityId: this.cleanStr(input.entityId),
            link: this.cleanStr(input.link),
            metaJson: input.metaJson ?? null,
          },
        }),
      ),
    );

    for (const item of created) {
      this.gateway.emitNotificationToUser(item.userId, item);
    }

    await Promise.all(
      uniqueUserIds.map((userId) => this.pushUnreadCount(userId)),
    );

    return { count: created.length, items: created };
  }

  async listMy(
    user: ReqUser,
    query?: {
      unreadOnly?: string | boolean;
      take?: string | number;
    },
  ) {
    this.ensureAuth(user);

    const unreadOnly =
      query?.unreadOnly === true || query?.unreadOnly === "true";
    const take = Math.min(100, Math.max(1, Number(query?.take || 30)));

    return this.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take,
    });
  }

  async unreadCount(user: ReqUser) {
    this.ensureAuth(user);

    const count = await this.prisma.notification.count({
      where: {
        userId: user.id,
        isRead: false,
      },
    });

    return { unread: count };
  }

  async markRead(user: ReqUser, notificationId: string) {
    this.ensureAuth(user);

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        userId: true,
        isRead: true,
      },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    if (notification.userId !== user.id) {
      throw new ForbiddenException("No access");
    }

    let updated: any;

    if (notification.isRead) {
      updated = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
    } else {
      updated = await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    }

    await this.pushUnreadCount(user.id);
    return updated;
  }

  async markUnread(user: ReqUser, notificationId: string) {
    this.ensureAuth(user);

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    if (notification.userId !== user.id) {
      throw new ForbiddenException("No access");
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: false,
        readAt: null,
      },
    });

    await this.pushUnreadCount(user.id);
    return updated;
  }

  async markAllRead(user: ReqUser) {
    this.ensureAuth(user);

    const result = await this.prisma.notification.updateMany({
      where: {
        userId: user.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    await this.pushUnreadCount(user.id);

    return { updatedCount: result.count };
  }

  async remove(user: ReqUser, notificationId: string) {
    this.ensureAuth(user);

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    if (notification.userId !== user.id) {
      throw new ForbiddenException("No access");
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    await this.pushUnreadCount(user.id);

    return { success: true };
  }

  async removeAllRead(user: ReqUser) {
    this.ensureAuth(user);

    const result = await this.prisma.notification.deleteMany({
      where: {
        userId: user.id,
        isRead: true,
      },
    });

    await this.pushUnreadCount(user.id);

    return { deletedCount: result.count };
  }
}