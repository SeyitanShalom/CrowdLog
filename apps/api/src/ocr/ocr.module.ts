import { Module } from "@nestjs/common";
import { MockOcrProvider } from "./mock-ocr.provider";
import { OCR_PROVIDER } from "./ocr-provider.interface";

@Module({
  providers: [
    MockOcrProvider,
    {
      provide: OCR_PROVIDER,
      useExisting: MockOcrProvider,
    },
  ],
  exports: [OCR_PROVIDER],
})
export class OcrModule {}
