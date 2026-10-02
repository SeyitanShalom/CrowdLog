import { Module } from "@nestjs/common";
import { AzureDocumentIntelligenceOcrProvider } from "./azure-document-intelligence-ocr.provider";
import { ConfiguredOcrProvider } from "./configured-ocr.provider";
import { GoogleDocumentAiOcrProvider } from "./google-document-ai-ocr.provider";
import { HttpOcrProvider } from "./http-ocr.provider";
import { MockOcrProvider } from "./mock-ocr.provider";
import { OcrDeploymentCheckService } from "./ocr-deployment-check.service";
import { OcrHealthController } from "./ocr-health.controller";
import { OCR_PROVIDER } from "./ocr-provider.interface";
import { PdfPageRenderer } from "./pdf-page-renderer";
import { WindowsOcrProvider } from "./windows-ocr.provider";

@Module({
  controllers: [OcrHealthController],
  providers: [
    AzureDocumentIntelligenceOcrProvider,
    ConfiguredOcrProvider,
    GoogleDocumentAiOcrProvider,
    HttpOcrProvider,
    MockOcrProvider,
    OcrDeploymentCheckService,
    PdfPageRenderer,
    WindowsOcrProvider,
    {
      provide: OCR_PROVIDER,
      useExisting: ConfiguredOcrProvider,
    },
  ],
  exports: [OCR_PROVIDER, PdfPageRenderer],
})
export class OcrModule {}
