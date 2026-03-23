import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AgenciesService } from "./agencies.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("agencies")
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES")
  list(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("assignedSalesId") assignedSalesId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.agencies.listAgencies(req.user, {
      q,
      status,
      assignedSalesId,
      page,
      pageSize,
    });
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES")
  getOne(@Req() req: any, @Param("id") id: string) {
    return this.agencies.getAgency(req.user, id);
  }

  @Post()
  @Roles("ADMIN", "MANAGER")
  create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      contactName?: string;
      phone?: string;
      email?: string;
      city?: string;
      country?: string;
      address?: string;
      website?: string;
      source?: string;
      notesSummary?: string;
      assignedSalesId?: string | null;
    },
  ) {
    return this.agencies.createAgency(req.user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER")
  update(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      city?: string;
      country?: string;
      address?: string;
      website?: string;
      source?: string;
      notesSummary?: string;
      status?: "ACTIVE" | "PASSIVE" | "PROSPECT" | "DEALING" | "CLOSED";
    },
  ) {
    return this.agencies.updateAgency(req.user, id, body);
  }

  @Post(":id/assign-sales")
  @Roles("ADMIN", "MANAGER")
  assignSales(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { salesId?: string | null },
  ) {
    return this.agencies.assignSales(req.user, id, body);
  }

  @Post(":id/notes")
  @Roles("ADMIN", "MANAGER", "SALES")
  addNote(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { note: string },
  ) {
    return this.agencies.addNote(req.user, id, body);
  }

  @Post(":id/meetings")
  @Roles("ADMIN", "MANAGER", "SALES")
  createMeeting(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title: string;
      notes?: string;
      meetingAt: string;
    },
  ) {
    return this.agencies.createMeeting(req.user, id, body);
  }

  @Patch("meetings/:meetingId")
  @Roles("ADMIN", "MANAGER", "SALES")
  updateMeeting(
    @Req() req: any,
    @Param("meetingId") meetingId: string,
    @Body()
    body: {
      title?: string;
      notes?: string;
      meetingAt?: string;
    },
  ) {
    return this.agencies.updateMeeting(req.user, meetingId, body);
  }

  @Post(":id/tasks")
  @Roles("ADMIN", "MANAGER")
  createTask(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title: string;
      description?: string;
      dueAt?: string;
      assignedToId?: string | null;
      priority?: "LOW" | "MEDIUM" | "HIGH";
    },
  ) {
    return this.agencies.createTask(req.user, id, body);
  }

  @Patch("tasks/:taskId")
  @Roles("ADMIN", "MANAGER", "SALES")
  updateTask(
    @Req() req: any,
    @Param("taskId") taskId: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      dueAt?: string | null;
      assignedToId?: string | null;
      priority?: "LOW" | "MEDIUM" | "HIGH";
      status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
    },
  ) {
    return this.agencies.updateTask(req.user, taskId, body);
  }
}