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
import { LeadsService } from "./leads.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import type { ActivityType, LeadStatus } from "../common/types";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("leads")
export class LeadsController {
  constructor(private leads: LeadsService) {}

  private toPositiveNumber(value: string | undefined, fallback: number) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const num = Number(value);

    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException("Invalid numeric query parameter");
    }

    return Math.floor(num);
  }

  @Post()
  @Roles("CALLCENTER", "ADMIN")
  create(
    @Req() req: any,
    @Body()
    body: {
      fullName: string;
      phone: string;
      email?: string;
      source?: string;
    },
  ) {
    return this.leads.createLead(req.user, body);
  }

  @Get()
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  list(
    @Req() req: any,
    @Query("status") status?: LeadStatus,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
  ) {
    return this.leads.listLeads(req.user, {
      status,
      page: this.toPositiveNumber(page, 1),
      pageSize: this.toPositiveNumber(pageSize, 25),
      q: q || "",
    });
  }

  @Get("followups")
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  followups(@Req() req: any, @Query("range") range?: string) {
    return this.leads.listFollowups(req.user, range);
  }

  @Get(":id")
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  getOne(@Req() req: any, @Param("id") id: string) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    return this.leads.getLead(req.user, id);
  }

  @Patch(":id/core")
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  updateCore(@Req() req: any, @Param("id") id: string, @Body() patch: any) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    return this.leads.updateLeadCore(req.user, id, patch);
  }

  @Post(":id/activity")
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  addActivity(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      type: ActivityType;
      summary: string;
      details?: string;
      callOutcome?: string;
      lastContactAt?: string;
      nextFollowUpAt?: string;
    },
  ) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    return this.leads.addActivity(req.user, id, body);
  }

  @Post(":id/status")
  @Roles("CALLCENTER", "MANAGER", "ADMIN", "SALES")
  changeStatus(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { to: LeadStatus },
  ) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    if (!body?.to) {
      throw new BadRequestException("Target status is required");
    }

    return this.leads.changeStatus(req.user, id, body.to);
  }

  @Post(":id/send-to-manager")
  @Roles("CALLCENTER", "ADMIN")
  sendToManager(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { managerId: string },
  ) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    if (!body?.managerId?.trim()) {
      throw new BadRequestException("managerId is required");
    }

    return this.leads.sendToManager(req.user, id, body.managerId.trim());
  }

  @Post(":id/assign-to-sales")
  @Roles("MANAGER", "ADMIN")
  assignToSales(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { salesId: string },
  ) {
    if (!id) {
      throw new BadRequestException("Lead id is required");
    }

    if (!body?.salesId?.trim()) {
      throw new BadRequestException("salesId is required");
    }

    return this.leads.assignToSales(req.user, id, body.salesId.trim());
  }

  @Delete("bulk")
  @Roles("ADMIN", "MANAGER")
  bulkDelete(@Req() req: any, @Body() body: { ids: string[] }) {
    if (!Array.isArray(body?.ids)) {
      throw new BadRequestException("ids must be an array");
    }

    return this.leads.bulkDelete(req.user, body);
  }
}