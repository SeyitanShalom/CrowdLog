import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RecordsController } from "./records.controller";
import { RecordsService } from "./records.service";

@Module({
  imports: [PrismaModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
