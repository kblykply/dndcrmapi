import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";

@UseGuards(JwtAuthGuard)
@Controller("auth")
export class MeController {
  constructor(private prisma: PrismaService) {}

  @Get("me")
  async me(@Req() req: any) {
    const userId = req.user?.sub; // subject = user.id from JWT

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true, // ✅ include avatar
      },
    });

    return user;
  }
}