import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { OrgChartService } from "./org-chart.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("org-chart")
export class OrgChartController {
  constructor(private readonly orgChart: OrgChartService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  listTree(@Req() req: any) {
    return this.orgChart.getTree(req.user);
  }

  @Get("flat")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  listFlat(@Req() req: any) {
    return this.orgChart.listFlat(req.user);
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  getOne(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Node id is required");
    }

    return this.orgChart.getOne(req.user, id.trim());
  }

  @Post()
  @Roles("ADMIN", "MANAGER")
  create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      type?: string | null;
      color?: string | null;
      parentId?: string | null;
      order?: number;
    },
  ) {
    return this.orgChart.create(req.user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER")
  update(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      type?: string | null;
      color?: string | null;
      parentId?: string | null;
      order?: number;
    },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Node id is required");
    }

    return this.orgChart.update(req.user, id.trim(), body);
  }

  @Delete(":id")
  @Roles("ADMIN", "MANAGER")
  remove(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Node id is required");
    }

    return this.orgChart.remove(req.user, id.trim());
  }
}