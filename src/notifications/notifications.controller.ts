import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  listMy(
    @Req() req: any,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("take") take?: string,
  ) {
    return this.notifications.listMy(req.user, {
      unreadOnly: unreadOnly === "true",
      take: take ? Number(take) : undefined,
    });
  }

  @Get("unread-count")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  unreadCount(@Req() req: any) {
    return this.notifications.unreadCount(req.user);
  }

  @Patch("read-all")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  markAllRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user);
  }

  @Patch(":id/read")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  markRead(@Req() req: any, @Param("id") id: string) {
    return this.notifications.markRead(req.user, id);
  }

  @Patch(":id/unread")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  markUnread(@Req() req: any, @Param("id") id: string) {
    return this.notifications.markUnread(req.user, id);
  }

  @Delete("read")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  removeAllRead(@Req() req: any) {
    return this.notifications.removeAllRead(req.user);
  }

  @Delete(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  remove(@Req() req: any, @Param("id") id: string) {
    return this.notifications.remove(req.user, id);
  }
}