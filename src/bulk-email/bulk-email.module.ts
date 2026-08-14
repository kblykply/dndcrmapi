import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { BulkEmailController } from "./bulk-email.controller";
import { BulkEmailService } from "./bulk-email.service";

@Module({
  imports: [EmailModule],
  controllers: [BulkEmailController],
  providers: [BulkEmailService],
})
export class BulkEmailModule {}
