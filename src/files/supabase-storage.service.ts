import { Injectable, ForbiddenException } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseStorageService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  private bucket = process.env.SUPABASE_BUCKET || "avatars";

  async uploadUserAvatar(userId: string, buffer: Buffer, contentType: string) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new ForbiddenException("Supabase env missing");
    }

    const ext =
      contentType === "image/png" ? "png" :
      contentType === "image/webp" ? "webp" :
      "jpg";

    const path = `users/${userId}.${ext}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
        cacheControl: "3600",
      });

    if (error) throw new Error(error.message);

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}