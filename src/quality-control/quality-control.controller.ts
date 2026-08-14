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
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { QualityControlService } from "./quality-control.service";

type QualityProcessCategory =
  | "CONTEXT"
  | "PLANNING"
  | "LEADERSHIP"
  | "SUPPORT"
  | "OPERATIONAL"
  | "PERFORMANCE"
  | "IMPROVEMENT"
  | "CONSTRUCTION"
  | "REAL_ESTATE_SALES"
  | "VALUE";

type QualityProcessStatus = "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";
type QualityDocumentType =
  | "PROCEDURE"
  | "POLICY"
  | "FORM"
  | "CHECKLIST"
  | "RECORD"
  | "DRAWING"
  | "CONTRACT"
  | "REPORT"
  | "OTHER";
type QualityDocumentStatus = "DRAFT" | "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";

type CardBody = {
  code?: string | null;
  title?: string | null;
  description?: string | null;
  category?: QualityProcessCategory | null;
  status?: QualityProcessStatus | null;
  ownerDepartment?: string | null;
  color?: string | null;
  sortOrder?: number | string | null;
};

type ChecklistBody = {
  title?: string | null;
  description?: string | null;
  required?: boolean | null;
  isChecked?: boolean | null;
  dueAt?: string | null;
  sortOrder?: number | string | null;
};

type DocumentBody = {
  title?: string | null;
  type?: QualityDocumentType | null;
  status?: QualityDocumentStatus | null;
  revision?: string | null;
  ownerDepartment?: string | null;
  url?: string | null;
  storagePath?: string | null;
  fileName?: string | null;
  notes?: string | null;
};

const QUALITY_ROLES = ["ADMIN", "MANAGER", "AFTERSALES", "SALES"] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("quality-control")
export class QualityControlController {
  constructor(private readonly quality: QualityControlService) {}

  @Get()
  @Roles(...QUALITY_ROLES)
  listCards(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("category") category?: QualityProcessCategory | "ALL",
    @Query("status") status?: QualityProcessStatus | "ALL",
  ) {
    return this.quality.listCards(req.user, { q, category, status });
  }

  @Post()
  @Roles(...QUALITY_ROLES)
  createCard(@Req() req: any, @Body() body: CardBody) {
    return this.quality.createCard(req.user, body);
  }

  @Get(":id")
  @Roles(...QUALITY_ROLES)
  getCard(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Quality card id is required");
    }
    return this.quality.getCard(req.user, id.trim());
  }

  @Patch(":id")
  @Roles(...QUALITY_ROLES)
  updateCard(@Req() req: any, @Param("id") id: string, @Body() body: CardBody) {
    if (!id?.trim()) {
      throw new BadRequestException("Quality card id is required");
    }
    return this.quality.updateCard(req.user, id.trim(), body);
  }

  @Post(":id/checklists")
  @Roles(...QUALITY_ROLES)
  createChecklistItem(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: ChecklistBody,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Quality card id is required");
    }
    return this.quality.createChecklistItem(req.user, id.trim(), body);
  }

  @Patch(":id/checklists/:itemId")
  @Roles(...QUALITY_ROLES)
  updateChecklistItem(
    @Req() req: any,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: ChecklistBody,
  ) {
    if (!id?.trim() || !itemId?.trim()) {
      throw new BadRequestException("Quality checklist ids are required");
    }
    return this.quality.updateChecklistItem(req.user, id.trim(), itemId.trim(), body);
  }

  @Delete(":id/checklists/:itemId")
  @Roles(...QUALITY_ROLES)
  deleteChecklistItem(
    @Req() req: any,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
  ) {
    if (!id?.trim() || !itemId?.trim()) {
      throw new BadRequestException("Quality checklist ids are required");
    }
    return this.quality.deleteChecklistItem(req.user, id.trim(), itemId.trim());
  }

  @Post(":id/documents")
  @Roles(...QUALITY_ROLES)
  createDocument(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: DocumentBody,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Quality card id is required");
    }
    return this.quality.createDocument(req.user, id.trim(), body);
  }

  @Patch(":id/documents/:documentId")
  @Roles(...QUALITY_ROLES)
  updateDocument(
    @Req() req: any,
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() body: DocumentBody,
  ) {
    if (!id?.trim() || !documentId?.trim()) {
      throw new BadRequestException("Quality document ids are required");
    }
    return this.quality.updateDocument(req.user, id.trim(), documentId.trim(), body);
  }

  @Delete(":id/documents/:documentId")
  @Roles(...QUALITY_ROLES)
  deleteDocument(
    @Req() req: any,
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    if (!id?.trim() || !documentId?.trim()) {
      throw new BadRequestException("Quality document ids are required");
    }
    return this.quality.deleteDocument(req.user, id.trim(), documentId.trim());
  }

  @Post(":id/logs")
  @Roles(...QUALITY_ROLES)
  addLog(@Req() req: any, @Param("id") id: string, @Body() body: { note?: string | null }) {
    if (!id?.trim()) {
      throw new BadRequestException("Quality card id is required");
    }
    return this.quality.addLog(req.user, id.trim(), body?.note);
  }
}
