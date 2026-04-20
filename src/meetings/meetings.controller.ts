import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("meetings")
export class MeetingsController {
  constructor(private meetings: MeetingsService) {}

 @Get()
@Roles("ADMIN", "MANAGER", "SALES")
list(
  @Req() req: any,
  @Query("q") q?: string,
  @Query("kind") kind?: "ALL" | "AGENCY" | "PRESENTATION",
  @Query("agencyId") agencyId?: string,
  @Query("from") from?: string,
  @Query("to") to?: string,
  @Query("page") page?: string,
  @Query("pageSize") pageSize?: string,
) {
  return this.meetings.listMeetings(req.user, {
    q,
    kind,
    agencyId,
    from,
    to,
    page,
    pageSize,
  });
}

  @Get(":kind/:id")
  @Roles("ADMIN", "MANAGER", "SALES")
  getOne(
    @Req() req: any,
    @Param("kind") kind: "AGENCY" | "PRESENTATION",
    @Param("id") id: string,
  ) {
    if (!id) {
      throw new BadRequestException("Meeting id is required");
    }

    if (kind !== "AGENCY" && kind !== "PRESENTATION") {
      throw new BadRequestException("Invalid meeting kind");
    }

    return this.meetings.getMeeting(req.user, kind, id);
  }

  @Post()
  @Roles("ADMIN", "MANAGER", "SALES")
  create(
    @Req() req: any,
    @Body()
    body: {
      kind: "AGENCY" | "PRESENTATION";
      title: string;
      notes?: string;
      meetingAt: string;
      agencyId?: string;
      customerId?: string;
      assignedSalesId?: string;
      projectName?: string;
      location?: string;
    },
  ) {
    if (!body?.kind) {
      throw new BadRequestException("kind is required");
    }

    return this.meetings.createMeeting(req.user, body);
  }
}