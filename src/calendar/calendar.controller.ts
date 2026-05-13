import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import { CalendarService } from "./calendar.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get("feed")
  @Roles("ADMIN", "MANAGER", "CALLCENTER", "SALES")
  feed(
    @Req() req: any,
    @Query("from") from?: string,
    @Query("to") to?: string,

    @Query("type") type?: string,
    @Query("assignedUserId") assignedUserId?: string,

    @Query("types") types?: string,
    @Query("assignedUserIds") assignedUserIds?: string,
    @Query("roles") roles?: string,
    @Query("search") search?: string,
  ) {
    return this.calendar.getFeed(req.user, {
      from,
      to,
      type,
      assignedUserId,
      types,
      assignedUserIds,
      roles,
      search,
    });
  }

  @Get("summary")
  @Roles("ADMIN", "MANAGER", "CALLCENTER", "SALES")
  summary(@Req() req: any) {
    return this.calendar.getTodaySummary(req.user);
  }
}