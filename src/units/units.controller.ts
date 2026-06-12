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
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { UnitsService } from "./units.service";

type ProjectType =
  | "LA_JOYA"
  | "LA_JOYA_PERLA"
  | "LA_JOYA_PERLA_II"
  | "LAGOON_VERDE";

type UnitDeliveryStatus = "NOT_READY" | "READY_TO_DELIVER" | "DELIVERED";
type UnitCompanyStatus = "UNKNOWN" | "DND" | "OTHER";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("units")
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES")
  list(
    @Req() req: any,
    @Query("project") project?: ProjectType | "",
    @Query("deliveryStatus") deliveryStatus?: UnitDeliveryStatus | "",
    @Query("companyStatus") companyStatus?: UnitCompanyStatus | "",
    @Query("q") q?: string,
  ) {
    return this.units.listUnits(req.user, {
      project,
      deliveryStatus,
      companyStatus,
      q,
    });
  }

  @Get("reports/end-of-day")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  endOfDayReport(@Req() req: any, @Query("date") date?: string) {
    return this.units.endOfDayReport(req.user, date);
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES")
  detail(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Unit id is required");
    }

    return this.units.getUnit(req.user, id.trim());
  }

  @Post(":id/communication-log")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES")
  communicationLog(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { type?: string | null; message?: string | null },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Unit id is required");
    }

    return this.units.recordCommunication(req.user, id.trim(), body);
  }

  @Post(":id/send-email")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES")
  sendEmail(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { subject?: string | null; message?: string | null },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Unit id is required");
    }

    return this.units.sendUnitEmail(req.user, id.trim(), body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER", "SALES", "CALLCENTER", "AFTERSALES")
  update(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      deliveryStatus?: UnitDeliveryStatus | null;
      companyStatus?: UnitCompanyStatus | null;
      generalInfo?: string | null;
      unitInfo?: string | null;
      customerRequest?: string | null;
      customerComplaint?: string | null;
      unitComplaint?: string | null;
      isCanceled?: boolean | null;
      cancelReason?: string | null;
      kdvStatus?: string | null;
      trafoStatus?: string | null;
      installments?: any;
      electricityProvider?: string | null;
      waterAccessStatus?: string | null;
      rentalPackage?: string | null;
      customFurniture?: string | null;
      rentalStatus?: string | null;
    },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Unit id is required");
    }

    return this.units.updateUnit(req.user, id.trim(), body);
  }
}
