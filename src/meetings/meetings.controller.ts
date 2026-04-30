import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

type MeetingKind = "AGENCY" | "PRESENTATION" | "OTHER";
type MeetingKindFilter = "ALL" | MeetingKind;

type CreateMeetingBody = {
  kind: MeetingKind;
  title: string;
  notes?: string;
  meetingAt: string;

  agencyId?: string;
  customerId?: string;
  assignedSalesId?: string;

  projectName?: string;
  location?: string;

  contactName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
};

type UpdateMeetingBody = {
  title?: string;
  notes?: string;
  meetingAt?: string;
  status?: string;
  outcome?: string | null;

  agencyId?: string | null;
  customerId?: string | null;
  assignedSalesId?: string | null;

  projectName?: string;
  location?: string;

  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
};

function validateKind(kind: string): asserts kind is MeetingKind {
  if (kind !== "AGENCY" && kind !== "PRESENTATION" && kind !== "OTHER") {
    throw new BadRequestException("Invalid meeting kind");
  }
}

function validateKindFilter(kind: string): asserts kind is MeetingKindFilter {
  if (
    kind !== "ALL" &&
    kind !== "AGENCY" &&
    kind !== "PRESENTATION" &&
    kind !== "OTHER"
  ) {
    throw new BadRequestException("Invalid meeting kind");
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES")
  list(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("kind") kind: string = "ALL",
    @Query("agencyId") agencyId?: string,
    @Query("assignedSalesId") assignedSalesId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    validateKindFilter(kind);

    return this.meetings.listMeetings(req.user, {
      q,
      kind,
      agencyId,
      assignedSalesId,
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
    @Param("kind") kind: string,
    @Param("id") id: string,
  ) {
    if (!id) throw new BadRequestException("Meeting id is required");

    validateKind(kind);

    return this.meetings.getMeeting(req.user, kind, id);
  }

  @Post()
  @Roles("ADMIN", "MANAGER", "SALES")
  create(@Req() req: any, @Body() body: CreateMeetingBody) {
    if (!body?.kind) throw new BadRequestException("kind is required");

    validateKind(body.kind);

    return this.meetings.createMeeting(req.user, body);
  }

  @Patch(":kind/:id")
  @Roles("ADMIN", "MANAGER", "SALES")
  update(
    @Req() req: any,
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() body: UpdateMeetingBody,
  ) {
    if (!id) throw new BadRequestException("Meeting id is required");

    validateKind(kind);

    return this.meetings.updateMeeting(req.user, kind, id, body);
  }

  @Delete(":kind/:id")
  @Roles("ADMIN", "MANAGER", "SALES")
  delete(
    @Req() req: any,
    @Param("kind") kind: string,
    @Param("id") id: string,
  ) {
    if (!id) throw new BadRequestException("Meeting id is required");

    validateKind(kind);

    return this.meetings.deleteMeeting(req.user, kind, id);
  }
}