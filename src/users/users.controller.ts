import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import type { Role } from "../common/types";

type CreateUserDto = {
  name: string;
  email: string;
  password: string;
  role: Role;
  managerId?: string | null;
};

type UpdateUserDto = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  managerId?: string | null;
  isActive?: boolean;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("users")
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query("role") role?: Role, @Query("all") all?: string) {
    const where: any = {};

    if (all !== "true") where.isActive = true;
    if (role) where.role = role;

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  @Get(":id")
  @Roles("ADMIN")
  async getOne(@Param("id") id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    return user;
  }

  @Post()
  @Roles("ADMIN")
  async create(@Body() body: CreateUserDto) {
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();
    const role = body.role;
    const managerId = body.managerId || null;

    if (!name) throw new BadRequestException("Name is required");
    if (!email) throw new BadRequestException("Email is required");
    if (!password || password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }
    if (!role) throw new BadRequestException("Role is required");

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException("A user with this email already exists");
    }

    if (managerId) {
      const manager = await this.prisma.user.findUnique({
        where: { id: managerId },
        select: { id: true, role: true, isActive: true },
      });

      if (!manager || !manager.isActive) {
        throw new BadRequestException("Selected manager not found or inactive");
      }

      if (manager.role !== "MANAGER" && manager.role !== "ADMIN") {
        throw new BadRequestException("managerId must belong to a MANAGER or ADMIN");
      }
    }

    const passwordHash = await argon2.hash(password);

    return this.prisma.user.create({
      data: {
        name,
        email,
        role,
        passwordHash,
        isActive: true,
        managerId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
  }

  @Patch(":id")
  @Roles("ADMIN")
  async update(@Param("id") id: string, @Body() body: UpdateUserDto) {
    const data: any = {};

    if (typeof body.name === "string") data.name = body.name.trim();
    if (typeof body.email === "string") data.email = body.email.trim().toLowerCase();
    if (typeof body.role === "string") data.role = body.role;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if ("managerId" in body) data.managerId = body.managerId || null;

    if (typeof body.password === "string" && body.password.trim()) {
      if (body.password.trim().length < 8) {
        throw new BadRequestException("Password must be at least 8 characters");
      }
      data.passwordHash = await argon2.hash(body.password.trim());
    }

    if (data.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      });

      if (existing && existing.id !== id) {
        throw new BadRequestException("Another user already uses this email");
      }
    }

    if ("managerId" in data && data.managerId) {
      const manager = await this.prisma.user.findUnique({
        where: { id: data.managerId },
        select: { id: true, role: true, isActive: true },
      });

      if (!manager || !manager.isActive) {
        throw new BadRequestException("Selected manager not found or inactive");
      }

      if (manager.role !== "MANAGER" && manager.role !== "ADMIN") {
        throw new BadRequestException("managerId must belong to a MANAGER or ADMIN");
      }
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
  }

  @Patch(":id/deactivate")
  @Roles("ADMIN")
  async deactivate(@Param("id") id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }

  @Delete(":id")
  @Roles("ADMIN")
  async deleteUser(@Req() req: any, @Param("id") id: string) {
    const currentUserId = req.user?.sub as string | undefined;

    if (!id) throw new BadRequestException("User id is required");
    if (currentUserId && currentUserId === id) {
      throw new BadRequestException("You cannot delete your own account");
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        callcenterLeads: { select: { id: true } },
        managedLeads: { select: { id: true } },
        salesLeads: { select: { id: true } },
        activities: { select: { id: true } },
        tasksCreated: { select: { id: true } },
        tasksAssigned: { select: { id: true } },
        audits: { select: { id: true } },
        refreshTokens: { select: { id: true } },
        stageChanges: { select: { id: true } },
        reps: { select: { id: true } },
      },
    });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    const blockers = {
      callcenterLeads: user.callcenterLeads.length,
      managedLeads: user.managedLeads.length,
      salesLeads: user.salesLeads.length,
      activities: user.activities.length,
      tasksCreated: user.tasksCreated.length,
      tasksAssigned: user.tasksAssigned.length,
      audits: user.audits.length,
      stageChanges: user.stageChanges.length,
      reps: user.reps.length,
    };

    const hasBlockers = Object.values(blockers).some((count) => count > 0);

    if (hasBlockers) {
      throw new BadRequestException({
        message: "This user still has related business records. Deactivate instead of deleting.",
        blockers,
      });
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId: id },
    });

    await this.prisma.user.delete({
      where: { id },
    });

    return {
      deleted: true,
      id,
      email: user.email,
    };
  }

  @Delete(":id/force")
  @Roles("ADMIN")
  async forceDeleteUser(@Req() req: any, @Param("id") id: string) {
    const currentUserId = req.user?.sub as string | undefined;

    if (!id) throw new BadRequestException("User id is required");
    if (currentUserId && currentUserId === id) {
      throw new BadRequestException("You cannot force delete your own account");
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    const isLikelyTestUser =
      user.email.endsWith("@crm.local") ||
      user.email.includes("test") ||
      user.email.includes("demo");

    // İstersen bunu aç:
    // if (!isLikelyTestUser) {
    //   throw new ForbiddenException("Force delete is only allowed for test users");
    // }

    await this.prisma.$transaction(async (tx) => {
      // Alt kullanıcı bağlantılarını kopar
      await tx.user.updateMany({
        where: { managerId: id },
        data: { managerId: null },
      });

      // Görevleri temizle
      await tx.task.deleteMany({
        where: {
          OR: [{ createdById: id }, { assignedToId: id }],
        },
      });

      // Kullanıcının oluşturduğu lead aktiviteleri
      await tx.leadActivity.deleteMany({
        where: { createdById: id },
      });

      // Kullanıcının yaptığı stage değişimleri
      await tx.leadStageHistory.deleteMany({
        where: { changedById: id },
      });

      // Audit loglar
      await tx.auditLog.deleteMany({
        where: { actorId: id },
      });

      // Refresh tokenlar
      await tx.refreshToken.deleteMany({
        where: { userId: id },
      });

      // Lead bağlantılarını null yap
      await tx.lead.updateMany({
        where: { ownerCallCenterId: id },
        data: { ownerCallCenterId: null },
      });

      await tx.lead.updateMany({
        where: { assignedManagerId: id },
        data: { assignedManagerId: null },
      });

      await tx.lead.updateMany({
        where: { assignedSalesId: id },
        data: { assignedSalesId: null },
      });

      // Son olarak kullanıcıyı sil
      await tx.user.delete({
        where: { id },
      });
    });

    return {
      deleted: true,
      forced: true,
      id,
      email: user.email,
      testUserHeuristic: isLikelyTestUser,
    };
  }
}