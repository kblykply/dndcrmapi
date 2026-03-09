import { Controller, Get, Query, UseGuards, Req } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import type { Role } from "../common/types";



@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("users")
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any, @Query("role") role?: Role) {
    const where: any = { isActive: true };
    if (role) where.role = role;

    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, managerId: true },
      orderBy: { name: "asc" },
      take: 200,
    });
  }
}