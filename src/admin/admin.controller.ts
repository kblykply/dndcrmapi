import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import { AdminService } from "./admin.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  @Roles("ADMIN", "MANAGER")
  overview() {
    return this.admin.getOverview();
  }
}