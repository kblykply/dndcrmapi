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
import { TasksService } from "./tasks.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

type CrmTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
type CrmTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("my")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  listMy(
    @Req() req: any,
    @Query("status") status?: CrmTaskStatus,
    @Query("range") range?: string,
    @Query("search") search?: string,
  ) {
    return this.tasks.listMy(req.user, {
      status,
      range,
      search,
    });
  }

  @Get("team")
  @Roles("ADMIN", "MANAGER")
  listTeam(
    @Req() req: any,
    @Query("status") status?: CrmTaskStatus,
    @Query("range") range?: string,
    @Query("search") search?: string,
  ) {
    return this.tasks.listTeam(req.user, {
      status,
      range,
      search,
    });
  }

  @Get()
  @Roles("ADMIN", "MANAGER")
  listAll(
    @Req() req: any,
    @Query("status") status?: CrmTaskStatus,
    @Query("range") range?: string,
    @Query("search") search?: string,
    @Query("assignedToId") assignedToId?: string,
  ) {
    return this.tasks.listAll(req.user, {
      status,
      range,
      search,
      assignedToId,
    });
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  getOne(@Req() req: any, @Param("id") id: string) {
    return this.tasks.getOne(req.user, id);
  }

  @Post()
  @Roles("ADMIN", "MANAGER")
  create(
    @Req() req: any,
    @Body()
    body: {
      title: string;
      description?: string | null;
      status?: CrmTaskStatus;
      priority?: CrmTaskPriority;
      dueAt?: string | null;
      assignedToId?: string | null;
      leadId?: string | null;
      agencyId?: string | null;
      customerId?: string | null;
    },
  ) {
    return this.tasks.create(req.user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  update(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      priority?: CrmTaskPriority;
      status?: CrmTaskStatus;
      dueAt?: string | null;
      assignedToId?: string | null;
      leadId?: string | null;
      agencyId?: string | null;
      customerId?: string | null;
    },
  ) {
    return this.tasks.update(req.user, id, body);
  }

  @Patch(":id/done")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  markDone(@Req() req: any, @Param("id") id: string) {
    return this.tasks.markDone(req.user, id);
  }

  @Patch(":id/cancel")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  cancel(@Req() req: any, @Param("id") id: string) {
    return this.tasks.cancel(req.user, id);
  }
}