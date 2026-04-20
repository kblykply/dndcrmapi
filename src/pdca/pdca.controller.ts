import {
  BadRequestException,
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
import { PdcaService } from "./pdca.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

type PdcaPhase = "PLAN" | "DO" | "CHECK" | "ACT";
type PdcaStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
type PdcaPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type PdcaImpactLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type PdcaIssueCategory =
  | "SALES"
  | "MARKETING"
  | "OPERATIONS"
  | "CUSTOMER_SERVICE"
  | "FINANCE"
  | "HR"
  | "PROJECT"
  | "OTHER";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("pdca")
export class PdcaController {
  constructor(private readonly pdca: PdcaService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  listCases(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("phase") phase?: PdcaPhase | "ALL",
    @Query("status") status?: PdcaStatus | "ALL",
    @Query("priority") priority?: PdcaPriority | "ALL",
    @Query("impactLevel") impactLevel?: PdcaImpactLevel | "ALL",
    @Query("issueCategory") issueCategory?: PdcaIssueCategory | "ALL",
    @Query("assignedToId") assignedToId?: string,
    @Query("ownerId") ownerId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.pdca.listCases(req.user, {
      q,
      phase,
      status,
      priority,
      impactLevel,
      issueCategory,
      assignedToId,
      ownerId,
      page,
      pageSize,
    });
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  getCase(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    return this.pdca.getCase(req.user, id.trim());
  }

  @Post()
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  createCase(
    @Req() req: any,
    @Body()
    body: {
      title: string;
      problemSummary: string;
      department?: string | null;
      issueCategory?: PdcaIssueCategory | null;
      problemType?: string | null;
      impactLevel?: PdcaImpactLevel | null;
      priority?: PdcaPriority;
      phase?: PdcaPhase;
      status?: PdcaStatus;
      ownerId?: string | null;
      assignedToId?: string | null;
      rootCause?: string | null;
      targetResult?: string | null;
      actionPlan?: string | null;
      doNotes?: string | null;
      checkResult?: string | null;
      correctiveAction?: string | null;
      preventiveAction?: string | null;
      finalDecision?: string | null;
      dueAt?: string | null;
    },
  ) {
    return this.pdca.createCase(req.user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  updateCase(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      problemSummary?: string;
      department?: string | null;
      issueCategory?: PdcaIssueCategory | null;
      problemType?: string | null;
      impactLevel?: PdcaImpactLevel | null;
      priority?: PdcaPriority;
      phase?: PdcaPhase;
      status?: PdcaStatus;
      ownerId?: string | null;
      assignedToId?: string | null;
      rootCause?: string | null;
      targetResult?: string | null;
      actionPlan?: string | null;
      doNotes?: string | null;
      checkResult?: string | null;
      correctiveAction?: string | null;
      preventiveAction?: string | null;
      finalDecision?: string | null;
      dueAt?: string | null;
      closedAt?: string | null;
    },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    return this.pdca.updateCase(req.user, id.trim(), body);
  }

  @Post(":id/logs")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  addLog(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      note: string;
      phase?: PdcaPhase | null;
    },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    if (!body?.note?.trim()) {
      throw new BadRequestException("note is required");
    }

    return this.pdca.addLog(req.user, id.trim(), {
      note: body.note.trim(),
      phase: body.phase ?? null,
    });
  }

  @Patch(":id/phase")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  updatePhase(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { phase: PdcaPhase },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    if (!body?.phase) {
      throw new BadRequestException("phase is required");
    }

    return this.pdca.updatePhase(req.user, id.trim(), body.phase);
  }

  @Patch(":id/close")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER")
  closeCase(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    return this.pdca.closeCase(req.user, id.trim());
  }

  @Patch(":id/cancel")
  @Roles("ADMIN", "MANAGER")
  cancelCase(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("PDCA case id is required");
    }

    return this.pdca.cancelCase(req.user, id.trim());
  }
}