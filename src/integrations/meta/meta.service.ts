import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { PrismaService } from "../../prisma/prisma.service";

type MetaField = { name: string; values: string[] };

@Injectable()
export class MetaService {
  private readonly log = new Logger(MetaService.name);

  constructor(private prisma: PrismaService) {}

  private get accessToken() {
    return process.env.META_PAGE_ACCESS_TOKEN!;
  }

  async getDefaultCallcenterId() {
    const email = process.env.DEFAULT_CALLCENTER_EMAIL;
    if (!email) throw new Error("DEFAULT_CALLCENTER_EMAIL is missing");

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (!user) throw new Error(`Default callcenter user not found: ${email}`);
    if (user.role !== "CALLCENTER" && user.role !== "ADMIN") {
      throw new Error(`DEFAULT_CALLCENTER_EMAIL must be CALLCENTER (or ADMIN). Got: ${user.role}`);
    }

    return user.id;
  }

  async fetchLeadgen(leadgenId: string) {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}`;
    const { data } = await axios.get(url, {
      params: {
        fields: "created_time,field_data,ad_id,form_id",
        access_token: this.accessToken,
      },
      timeout: 15000,
    });

    return data as {
      created_time?: string;
      field_data?: MetaField[];
      ad_id?: string;
      form_id?: string;
      id: string;
    };
  }

  mapFields(fieldData: MetaField[] = []) {
    const get = (names: string[]) => {
      const f = fieldData.find((x) => names.includes(x.name));
      const v = f?.values?.[0]?.trim();
      return v || undefined;
    };

    const fullName =
      get(["full_name", "name"]) ||
      [get(["first_name"]), get(["last_name"])].filter(Boolean).join(" ") ||
      undefined;

    const email = get(["email"]);
    const phone = get(["phone_number", "phone"]);

    return { fullName, email, phone };
  }

  async upsertLeadFromMetaLeadgen(leadgenId: string) {
    const leadgen = await this.fetchLeadgen(leadgenId);
    const { fullName, email, phone } = this.mapFields(leadgen.field_data || []);

    const ownerCallCenterId = await this.getDefaultCallcenterId();

    const existing = await this.prisma.lead.findUnique({
      where: { metaLeadId: leadgenId },
      select: { id: true, fullName: true, email: true, phone: true },
    });

    if (existing) {
      // optional patch if missing info
      const patch: any = {};
      if ((!existing.fullName || existing.fullName === "Instagram Lead") && fullName) patch.fullName = fullName;
      if (!existing.email && email) patch.email = email;
      if ((!existing.phone || existing.phone === "-") && phone) patch.phone = phone;

      if (Object.keys(patch).length > 0) {
        await this.prisma.lead.update({ where: { id: existing.id }, data: patch });
      }

      return { leadId: existing.id, created: false };
    }

    const created = await this.prisma.lead.create({
      data: {
        fullName: fullName || "Instagram Lead",
        phone: phone || "-",
        email,
        source: "Instagram Lead Ads",
        status: "NEW" as any,
        ownerCallCenterId,

        metaPlatform: "LEAD_ADS" as any,
        metaLeadId: leadgenId,
      },
      select: { id: true },
    });

    return { leadId: created.id, created: true };
  }
}