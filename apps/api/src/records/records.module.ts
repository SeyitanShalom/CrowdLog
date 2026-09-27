import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OcrModule } from "../ocr/ocr.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RecordsController } from "./records.controller";
import { RecordsService } from "./records.service";

@Module({
  imports: [AuthModule, PrismaModule, OcrModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
