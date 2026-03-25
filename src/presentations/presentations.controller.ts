import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CustomersService } from "../customers/customers.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("presentations")
export class PresentationsController {
  constructor(private readonly customers: CustomersService) {}

  @Patch(":id")
  @Roles("ADMIN", "MANAGER", "SALES")
  updatePresentation(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      projectName?: string;
      presentationAt?: string;
      location?: string;
      status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "RESCHEDULED";
      outcome?: "POSITIVE" | "NEGATIVE" | "FOLLOW_UP" | "NO_DECISION" | "WON" | "LOST";
      notesSummary?: string;
    },
  ) {
    return this.customers.updatePresentation(req.user, id, body);
  }

  @Post(":id/notes")
  @Roles("ADMIN", "MANAGER", "SALES")
  addPresentationNote(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { note: string },
  ) {
    return this.customers.addPresentationNote(req.user, id, body);
  }
}