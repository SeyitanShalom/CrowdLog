import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DocumentsModule } from "./documents/documents.module";
import { EventsModule } from "./events/events.module";
import { OcrModule } from "./ocr/ocr.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RecordsModule } from "./records/records.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OcrModule,
    EventsModule,
    RecordsModule,
    DocumentsModule,
  ],
})
export class AppModule {}
