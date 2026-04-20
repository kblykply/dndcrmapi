import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CustomersService } from "./customers.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import { customerUploadConfig } from "../common/upload.config";

type CustomerDocumentType = "ID" | "PASSPORT" | "OTHER";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Roles("ADMIN", "MANAGER", "SALES")
  list(@Req() req: any) {
    return this.customers.listCustomers(req.user);
  }

  @Get(":id")
  @Roles("ADMIN", "MANAGER", "SALES")
  getOne(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    return this.customers.getCustomerDetail(req.user, id.trim());
  }

  @Post()
  @Roles("ADMIN", "MANAGER", "SALES")
  create(@Req() req: any, @Body() body: any) {
    return this.customers.createCustomer(req.user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER", "SALES")
  update(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    return this.customers.updateCustomer(req.user, id.trim(), body);
  }

  @Delete(":id")
  @Roles("ADMIN", "MANAGER")
  delete(@Req() req: any, @Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    return this.customers.deleteCustomer(req.user, id.trim());
  }

  @Post(":id/presentations")
  @Roles("ADMIN", "MANAGER", "SALES")
  createPresentation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    return this.customers.createPresentation(req.user, id.trim(), body);
  }

  @Post(":id/documents")
  @Roles("ADMIN", "MANAGER", "SALES")
  addDocument(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      type?: CustomerDocumentType;
      fileName: string;
      storagePath: string;
      mimeType?: string | null;
    },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    return this.customers.addCustomerDocument(req.user, id.trim(), body);
  }

  @Get(":id/documents/:documentId/url")
  @Roles("ADMIN", "MANAGER", "SALES")
  getDocumentUrl(
    @Req() req: any,
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    if (!documentId?.trim()) {
      throw new BadRequestException("Document id is required");
    }

    return this.customers.getCustomerDocumentUrl(
      req.user,
      id.trim(),
      documentId.trim(),
    );
  }

  @Delete(":id/documents/:documentId")
  @Roles("ADMIN", "MANAGER", "SALES")
  deleteDocument(
    @Req() req: any,
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    if (!documentId?.trim()) {
      throw new BadRequestException("Document id is required");
    }

    return this.customers.deleteCustomerDocument(
      req.user,
      id.trim(),
      documentId.trim(),
    );
  }

  @Post(":id/documents/upload")
  @Roles("ADMIN", "MANAGER", "SALES")
  @UseInterceptors(FileInterceptor("file", customerUploadConfig))
  uploadDocument(
    @Req() req: any,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type?: CustomerDocumentType },
  ) {
    if (!id?.trim()) {
      throw new BadRequestException("Customer id is required");
    }

    if (!file) {
      throw new BadRequestException("File is required");
    }

    return this.customers.uploadCustomerDocument(
      req.user,
      id.trim(),
      file,
      body,
    );
  }
}