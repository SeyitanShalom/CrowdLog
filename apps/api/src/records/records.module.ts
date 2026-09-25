import { Module } from "@nestjs/common";
import { OcrModule } from "../ocr/ocr.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RecordsController } from "./records.controller";
import { RecordsService } from "./records.service";

@Module({
  imports: [PrismaModule, OcrModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
