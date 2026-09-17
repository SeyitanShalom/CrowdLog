import { Module } from "@nestjs/common";
import { DocumentsModule } from "./documents/documents.module";
import { EventsModule } from "./events/events.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RecordsModule } from "./records/records.module";

@Module({
  imports: [PrismaModule, EventsModule, RecordsModule, DocumentsModule],
})
export class AppModule {}
