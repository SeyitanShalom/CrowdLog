import { Module } from "@nestjs/common";
import { ConfiguredOcrProvider } from "./configured-ocr.provider";
import { MockOcrProvider } from "./mock-ocr.provider";
import { OCR_PROVIDER } from "./ocr-provider.interface";
import { WindowsOcrProvider } from "./windows-ocr.provider";

@Module({
  providers: [
    ConfiguredOcrProvider,
    MockOcrProvider,
    WindowsOcrProvider,
    {
      provide: OCR_PROVIDER,
      useExisting: ConfiguredOcrProvider,
    },
  ],
  exports: [OCR_PROVIDER],
})
export class OcrModule {}
