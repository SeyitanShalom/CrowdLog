import { Module } from "@nestjs/common";
import { UploadStorageService } from "./upload-storage.service";

@Module({
  providers: [UploadStorageService],
  exports: [UploadStorageService],
})
export class StorageModule {}
