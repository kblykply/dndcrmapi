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
  async feed(
    @Req() req: any,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("type") type?: string,
    @Query("assignedUserId") assignedUserId?: string,
  ) {
    return this.calendar.getFeed(req.user, {
      from,
      to,
      type,
      assignedUserId,
    });
  }

  @Get("summary")
  @Roles("ADMIN", "MANAGER", "CALLCENTER", "SALES")
  async summary(@Req() req: any) {
    return this.calendar.getTodaySummary(req.user);
  }
}