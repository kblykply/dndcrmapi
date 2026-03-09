import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { MetaService } from "./meta.service";

@Controller("integrations/meta")
export class MetaController {
  constructor(private meta: MetaService) {}

  // Webhook verification (Meta calls this once when you set it up)
  @Get("webhook")
  verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ) {
    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      return challenge;
    }
    return "Invalid verify token";
  }

  // Webhook receiver
  @Post("webhook")
  @HttpCode(200)
  async receive(@Body() body: any) {
    const leadgenIds: string[] = [];

    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        if (change?.field === "leadgen") {
          const leadgenId = change?.value?.leadgen_id;
          if (leadgenId) leadgenIds.push(String(leadgenId));
        }
      }
    }

    const results: any[] = [];
    for (const id of leadgenIds) {
      try {
        const r = await this.meta.upsertLeadFromMetaLeadgen(id);
        results.push({ leadgenId: id, ...r });
      } catch (e: any) {
        results.push({ leadgenId: id, error: String(e?.message || e) });
      }
    }

    return { ok: true, leadgens: results };
  }
}