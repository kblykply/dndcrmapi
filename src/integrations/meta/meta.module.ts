import { Module } from "@nestjs/common";
import { MetaController } from "./meta.controller";
import { MetaService } from "./meta.service";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [MetaController],
  providers: [MetaService],
})
export class MetaModule {}