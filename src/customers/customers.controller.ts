import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES")
  list(@Req() req: any) {
    return this.customers.listCustomers(req.user);
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES")
  getOne(@Req() req: any, @Param("id") id: string) {
    return this.customers.getCustomerDetail(req.user, id);
  }

  @Post()
  @Roles("ADMIN", "MANAGER", "SALES")
  create(
    @Req() req: any,
    @Body()
    body: {
      fullName: string;
      companyName?: string;
      phone?: string;
      email?: string;
      city?: string;
      country?: string;
      address?: string;
      source?: string;
      notesSummary?: string;
      type?: "POTENTIAL" | "EXISTING";
      agencyId?: string | null;
      ownerId?: string | null;
    },
  ) {
    return this.customers.createCustomer(req.user, body);
  }

  @Delete(":id")
  @Roles("ADMIN", "MANAGER")
  delete(@Req() req: any, @Param("id") id: string) {
    return this.customers.deleteCustomer(req.user, id);
  }

  @Post(":id/presentations")
  @Roles("ADMIN", "MANAGER", "SALES")
  createPresentation(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title: string;
      projectName?: string;
      presentationAt: string;
      location?: string;
      notesSummary?: string;
      assignedSalesId?: string;
    },
  ) {
    return this.customers.createPresentation(req.user, id, body);
  }
}