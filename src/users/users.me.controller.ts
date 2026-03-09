import {
  Controller,
  Post,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  ForbiddenException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseStorageService } from "../files/supabase-storage.service";

@UseGuards(JwtAuthGuard)
@Controller("users/me")
export class UsersMeController {
  constructor(
    private prisma: PrismaService,
    private storage: SupabaseStorageService
  ) {}

  @Post("avatar")
  @UseInterceptors(FileInterceptor("file"))
  async uploadAvatar(@Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ForbiddenException("No file uploaded");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      throw new ForbiddenException("Only jpeg/png/webp allowed");
    }
    if (file.size > 3 * 1024 * 1024) {
      throw new ForbiddenException("Max 3MB");
    }

    const avatarUrl = await this.storage.uploadUserAvatar(
      req.user.id,
      file.buffer,
      file.mimetype
    );

    await this.prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
    });

    return { avatarUrl };
  }
}