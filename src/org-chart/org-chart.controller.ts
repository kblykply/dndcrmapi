import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { OrgActionDto, OrgAssignmentDto, OrgDefinitionDto, UpdateOrgDefinitionDto } from "./org-chart.dto";
import { OrgChartService, type OrgUser } from "./org-chart.service";

const READ_ROLES = ["ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES", "ACCOUNTING"] as const;
type Request = { user: OrgUser };

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...READ_ROLES)
@Controller("org-chart")
export class OrgChartController {
  constructor(private readonly org: OrgChartService) {}

  @Get()
  tree(@Req() req: Request) { return this.org.getTree(req.user); }

  @Get("workspace")
  workspace(@Req() req: Request) { return this.org.workspace(req.user); }

  @Get("flat")
  flat(@Req() req: Request) { return this.org.listFlat(req.user); }

  @Get(":id/history")
  history(@Req() req: Request, @Param("id") id: string, @Query("cursor") cursor?: string) {
    return this.org.history(req.user, id, cursor);
  }

  @Get(":id")
  detail(@Req() req: Request, @Param("id") id: string) { return this.org.getOne(req.user, id); }

  @Post()
  @Roles("ADMIN", "MANAGER")
  create(@Req() req: Request, @Body() body: OrgDefinitionDto) { return this.org.create(req.user, body); }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER")
  update(@Req() req: Request, @Param("id") id: string, @Body() body: UpdateOrgDefinitionDto) {
    return this.org.update(req.user, id, body);
  }

  @Post(":id/assignment")
  @Roles("ADMIN", "MANAGER")
  assign(@Req() req: Request, @Param("id") id: string, @Body() body: OrgAssignmentDto) {
    return this.org.assign(req.user, id, body);
  }

  @Post(":id/approve")
  @Roles("ADMIN", "MANAGER")
  approve(@Req() req: Request, @Param("id") id: string, @Body() body: OrgActionDto) {
    return this.org.action(req.user, id, "APPROVED", body);
  }

  @Post(":id/archive")
  @Roles("ADMIN", "MANAGER")
  archive(@Req() req: Request, @Param("id") id: string, @Body() body: OrgActionDto) {
    return this.org.action(req.user, id, "ARCHIVED", body);
  }

  @Delete(":id")
  @Roles("ADMIN", "MANAGER")
  remove(@Req() req: Request, @Param("id") id: string, @Body() body: OrgActionDto) {
    return this.org.action(req.user, id, "ARCHIVED", body);
  }

  @Post(":id/restore")
  @Roles("ADMIN", "MANAGER")
  restore(@Req() req: Request, @Param("id") id: string, @Body() body: OrgActionDto) {
    return this.org.action(req.user, id, "RESTORED", body);
  }

  @Post(":id/acknowledge")
  acknowledge(@Req() req: Request, @Param("id") id: string, @Body() body: OrgActionDto) {
    return this.org.action(req.user, id, "ACKNOWLEDGED", body);
  }
}
