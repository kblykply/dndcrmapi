import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { UserActivityService } from "./user-activity.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("user-activity")
export class UserActivityController {
  constructor(private service: UserActivityService) {}

  @Get()
  @Roles("ADMIN", "MANAGER")
  listUsers(@Req() req: any) {
    return this.service.listUsers();
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER")
  getUserActivity(@Req() req: any, @Param("id") id: string) {
    return this.service.getUserActivity(id);
  }
}