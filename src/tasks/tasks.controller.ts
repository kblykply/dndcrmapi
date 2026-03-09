import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { TasksService } from "./tasks.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("tasks")
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Get("my")
  my(@Req() req: any, @Query("status") status?: string, @Query("range") range?: string) {
    return this.tasks.listMy(req.user, { status, range });
  }

  @Get("team")
  team(@Req() req: any, @Query("status") status?: string, @Query("range") range?: string) {
    return this.tasks.listTeam(req.user, { status, range });
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.tasks.create(req.user, body);
  }

  @Post(":id/done")
  done(@Req() req: any, @Param("id") id: string) {
    return this.tasks.markDone(req.user, id);
  }

  @Post(":id/cancel")
  cancel(@Req() req: any, @Param("id") id: string) {
    return this.tasks.cancel(req.user, id);
  }
}