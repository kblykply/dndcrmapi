import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    // Select only what we need (includes avatarUrl)
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true, // ✅ IMPORTANT
        isActive: true,
        passwordHash: true,
      },
    });

    if (!user || !user.isActive) throw new UnauthorizedException("Invalid credentials");

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const accessToken = await this.jwt.signAsync(
      { role: user.role, email: user.email },
      {
        secret: process.env.JWT_ACCESS_SECRET!,
        expiresIn: "15m",
        subject: user.id,
      },
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl, // ✅ RETURN IT
      },
      accessToken,
    };
  }
}