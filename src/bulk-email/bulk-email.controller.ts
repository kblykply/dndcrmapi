import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { emailAttachmentUploadConfig } from "../common/upload.config";
import { perlaTemplate } from "./perla-template";
import { BadRequestException } from "@nestjs/common";
import { BulkEmailService } from "./bulk-email.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("bulk-email")
export class BulkEmailController {
  constructor(private readonly bulkEmail: BulkEmailService) {}

  private uploadedFiles(files?: {
    files?: Express.Multer.File[];
    file?: Express.Multer.File[];
  }) {
    return [...(files?.files || []), ...(files?.file || [])];
  }

  @Get("templates/perla/:language")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  async perlaPreview(@Param("language") language: string) {
    if (!["en", "tr", "ru", "fa"].includes(language))
      throw new BadRequestException("Unsupported language");
    const template = await perlaTemplate(language as "en" | "tr" | "ru" | "fa");
    let html = template.html;
    for (const asset of template.attachments)
      html = html.replaceAll(
        `cid:${asset.cid}`,
        `data:${asset.contentType};base64,${asset.content.toString("base64")}`,
      );
    return { subject: template.subject, text: template.text, html };
  }

  @Get("delivery-settings")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  deliverySettings() {
    return this.bulkEmail.deliverySettings();
  }

  @Get("campaigns")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  campaigns(@Query("project") project?: string) {
    return this.bulkEmail.listCampaigns(project);
  }

  @Get("report")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  report(
    @Req() req: any,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("project") project?: string,
  ) {
    return this.bulkEmail.report(req.user, { dateFrom, dateTo, project });
  }

  @Post("campaigns/:id/retry-failed")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  retryFailed(@Req() req: any, @Param("id") id: string) {
    return this.bulkEmail.retryFailedRecipients(req.user, id);
  }

  @Post("campaigns/:id/pause")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  pause(@Param("id") id: string) { return this.bulkEmail.pauseCampaign(id); }

  @Post("campaigns/:id/resume")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  resume(@Param("id") id: string) { return this.bulkEmail.resumeCampaign(id); }

  @Get("campaigns/:id/preview/:language")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  campaignPreview(@Param("id") id: string, @Param("language") language: string) {
    return this.bulkEmail.getCampaignPreview(id, language);
  }

  @Get("campaigns/:id")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  campaignDetail(@Param("id") id: string) {
    return this.bulkEmail.getCampaign(id);
  }

  @Get("recipients")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  recipients(
    @Req() req: any,
    @Query("project") project?: string,
    @Query("deliveryStatus") deliveryStatus?: string,
    @Query("ownerId") ownerId?: string,
    @Query("language") language?: string,
    @Query("nationality") nationality?: string,
    @Query("q") q?: string,
    @Query("selectedCustomerIds") selectedCustomerIds?: string,
  ) {
    return this.bulkEmail.previewRecipients(req.user, {
      project,
      deliveryStatus,
      ownerId,
      language,
      nationality,
      q,
      selectedCustomerIds: selectedCustomerIds
        ? selectedCustomerIds.split(",").filter(Boolean)
        : undefined,
    });
  }

  @Get("attachment-options")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  attachmentOptions(
    @Req() req: any,
    @Query("project") project?: string,
    @Query("deliveryStatus") deliveryStatus?: string,
    @Query("ownerId") ownerId?: string,
    @Query("language") language?: string,
    @Query("nationality") nationality?: string,
    @Query("q") q?: string,
    @Query("selectedCustomerIds") selectedCustomerIds?: string,
  ) {
    return this.bulkEmail.attachmentOptions(req.user, {
      project,
      deliveryStatus,
      ownerId,
      language,
      nationality,
      q,
      selectedCustomerIds: selectedCustomerIds
        ? selectedCustomerIds.split(",").filter(Boolean)
        : undefined,
    });
  }

  @Post("send")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "files", maxCount: 8 },
        { name: "file", maxCount: 1 },
      ],
      emailAttachmentUploadConfig,
    ),
  )
  send(
    @Req() req: any,
    @Body()
    body: {
      templateId?: string | null;
      campaignName?: string | null;
      project?: string | null;
      deliveryStatus?: string | null;
      ownerId?: string | null;
      language?: string | null;
      nationality?: string | null;
      q?: string | null;
      selectedCustomerIds?: string | string[] | null;
      selectedAttachmentIds?: string | string[] | null;
      subject?: string | null;
      message?: string | null;
    },
    @UploadedFiles()
    files?: {
      files?: Express.Multer.File[];
      file?: Express.Multer.File[];
    },
  ) {
    return this.bulkEmail.sendBulkEmail(
      req.user,
      body,
      this.uploadedFiles(files),
    );
  }

  @Post("test")
  @Roles("ADMIN", "MANAGER", "AFTERSALES")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "files", maxCount: 8 },
        { name: "file", maxCount: 1 },
      ],
      emailAttachmentUploadConfig,
    ),
  )
  test(
    @Req() req: any,
    @Body()
    body: {
      project?: string | null;
      deliveryStatus?: string | null;
      ownerId?: string | null;
      language?: string | null;
      nationality?: string | null;
      q?: string | null;
      selectedCustomerIds?: string | string[] | null;
      selectedAttachmentIds?: string | string[] | null;
      templateId?: string | null;
      previewCustomerId?: string | null;
      subject?: string | null;
      message?: string | null;
    },
    @UploadedFiles()
    files?: {
      files?: Express.Multer.File[];
      file?: Express.Multer.File[];
    },
  ) {
    return this.bulkEmail.sendTestEmail(
      req.user,
      body,
      this.uploadedFiles(files),
    );
  }
}
