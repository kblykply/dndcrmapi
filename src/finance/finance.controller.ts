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
import { FinanceService } from "./finance.service";

type FinanceEntryKind = "INCOME" | "EXPENSE";
type FinancePaymentType =
  | "SALE_INSTALLMENT"
  | "RENTAL_INCOME"
  | "CREDIT_INSTALLMENT"
  | "CHECK_PAYMENT"
  | "REALTOR_COMMISSION"
  | "SUBCONTRACTOR"
  | "INVOICE"
  | "OTHER"
  | "TAX"
  | "SALARY";
type FinancePaymentStatus = "PLANNED" | "PAID" | "OVERDUE" | "CANCELED";
type FinanceCurrency = "GBP" | "USD" | "EUR" | "TRY";
type ProjectType =
  | "LA_JOYA"
  | "LA_JOYA_PERLA"
  | "LA_JOYA_PERLA_II"
  | "LAGOON_VERDE";

type FinanceEntryBody = {
  kind?: FinanceEntryKind | null;
  paymentType?: FinancePaymentType | null;
  status?: FinancePaymentStatus | null;
  title?: string | null;
  description?: string | null;
  vendorName?: string | null;
  contractReference?: string | null;
  amount?: number | string | null;
  currency?: FinanceCurrency | null;
  exchangeRateToBase?: number | string | null;
  baseCurrency?: FinanceCurrency | null;
  originalDueDate?: string | null;
  plannedDueDate?: string | null;
  selectedDeferralDays?: number | string | null;
  paidAt?: string | null;
  customerId?: string | null;
  unitSelectionId?: string | null;
  project?: ProjectType | null;
  dueOptions?: Array<{ label?: string | null; daysFromOriginal?: number | string | null }> | null;
  splits?: Array<{
    method?: string | null;
    ratio?: number | string | null;
    amount?: number | string | null;
    unitSelectionId?: string | null;
    note?: string | null;
  }> | null;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("finance")
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("dashboard")
  @Roles("ADMIN", "ACCOUNTING")
  dashboard(
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("baseCurrency") baseCurrency?: FinanceCurrency,
  ) {
    return this.finance.dashboard({ dateFrom, dateTo, baseCurrency });
  }

  @Get("exchange-rates")
  @Roles("ADMIN", "ACCOUNTING")
  exchangeRates(
    @Query("baseCurrency") baseCurrency?: FinanceCurrency,
    @Query("currency") currency?: FinanceCurrency,
  ) {
    return this.finance.listExchangeRates({ baseCurrency, currency });
  }

  @Post("exchange-rates")
  @Roles("ADMIN", "ACCOUNTING")
  createExchangeRate(
    @Req() req: any,
    @Body()
    body: {
      currency?: FinanceCurrency | null;
      baseCurrency?: FinanceCurrency | null;
      rateToBase?: number | string | null;
      effectiveDate?: string | null;
      note?: string | null;
    },
  ) {
    return this.finance.createExchangeRate(req.user, body);
  }

  @Get("lookups/customers")
  @Roles("ADMIN", "ACCOUNTING")
  customerLookup(@Query("q") q?: string) {
    return this.finance.customerLookup(q);
  }

  @Get("lookups/units")
  @Roles("ADMIN", "ACCOUNTING")
  unitLookup(@Query("q") q?: string, @Query("project") project?: ProjectType) {
    return this.finance.unitLookup({ q, project });
  }

  @Get("entries")
  @Roles("ADMIN", "ACCOUNTING")
  entries(
    @Query("kind") kind?: FinanceEntryKind,
    @Query("paymentType") paymentType?: FinancePaymentType,
    @Query("status") status?: FinancePaymentStatus,
    @Query("currency") currency?: FinanceCurrency,
    @Query("project") project?: ProjectType,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("q") q?: string,
  ) {
    return this.finance.listEntries({
      kind,
      paymentType,
      status,
      currency,
      project,
      dateFrom,
      dateTo,
      q,
    });
  }

  @Post("entries")
  @Roles("ADMIN", "ACCOUNTING")
  createEntry(@Req() req: any, @Body() body: FinanceEntryBody) {
    return this.finance.createEntry(req.user, body);
  }

  @Get("entries/:id")
  @Roles("ADMIN", "ACCOUNTING")
  entry(@Param("id") id: string) {
    if (!id?.trim()) throw new BadRequestException("Finance entry id is required");
    return this.finance.getEntry(id.trim());
  }

  @Patch("entries/:id")
  @Roles("ADMIN", "ACCOUNTING")
  updateEntry(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: FinanceEntryBody,
  ) {
    if (!id?.trim()) throw new BadRequestException("Finance entry id is required");
    return this.finance.updateEntry(req.user, id.trim(), body);
  }

  @Post("entries/:id/select-due-option")
  @Roles("ADMIN", "ACCOUNTING")
  selectDueOption(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { optionId?: string | null; daysFromOriginal?: number | string | null },
  ) {
    if (!id?.trim()) throw new BadRequestException("Finance entry id is required");
    return this.finance.selectDueOption(req.user, id.trim(), body);
  }

  @Delete("entries/:id")
  @Roles("ADMIN", "ACCOUNTING")
  deleteEntry(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) throw new BadRequestException("Finance entry id is required");
    return this.finance.deleteEntry(req.user, id.trim());
  }
}
