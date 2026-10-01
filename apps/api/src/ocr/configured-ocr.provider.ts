import { Injectable } from "@nestjs/common";
import type {
  OcrExtractionInput,
  OcrExtractionResult,
  OcrProvider,
} from "./ocr-provider.interface";
import { AzureDocumentIntelligenceOcrProvider } from "./azure-document-intelligence-ocr.provider";
import { HttpOcrProvider } from "./http-ocr.provider";
import { MockOcrProvider } from "./mock-ocr.provider";
import { WindowsOcrProvider } from "./windows-ocr.provider";

type OcrProviderMode = "auto" | "mock" | "windows" | "http" | "azure";

@Injectable()
export class ConfiguredOcrProvider implements OcrProvider {
  readonly name = "configured";

  constructor(
    private readonly mockOcrProvider: MockOcrProvider,
    private readonly windowsOcrProvider: WindowsOcrProvider,
    private readonly httpOcrProvider: HttpOcrProvider,
    private readonly azureOcrProvider?: AzureDocumentIntelligenceOcrProvider,
  ) {}

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const mode = this.providerMode();

    if (mode === "mock") {
      return this.mockOcrProvider.extract(input);
    }

    if (mode === "http") {
      return this.httpOcrProvider.extract(input);
    }

    if (mode === "azure") {
      return this.azureProvider().extract(input);
    }

    if (this.canUseWindowsOcr(input)) {
      try {
        return await this.windowsOcrProvider.extract(input);
      } catch (error) {
        if (mode === "windows" || process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }
      }
    }

    if (this.canUseAzureOcr(input)) {
      try {
        return await this.azureProvider().extract(input);
      } catch (error) {
        if (process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }
      }
    }

    if (this.canUseHttpOcr()) {
      try {
        return await this.httpOcrProvider.extract(input);
      } catch (error) {
        if (process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }
      }
    }

    return this.mockOcrProvider.extract(input);
  }

  private providerMode(): OcrProviderMode {
    const value = process.env.OCR_PROVIDER?.toLowerCase();

    if (
      value === "mock" ||
      value === "windows" ||
      value === "http" ||
      value === "azure" ||
      value === "azure-document-intelligence"
    ) {
      if (value === "azure-document-intelligence") {
        return "azure";
      }

      return value;
    }

    return "auto";
  }

  private canUseWindowsOcr(input: OcrExtractionInput) {
    return (
      process.platform === "win32" &&
      Boolean(input.document.filePath) &&
      Boolean(input.document.fileType?.startsWith("image/"))
    );
  }

  private canUseHttpOcr() {
    return Boolean(process.env.OCR_HTTP_ENDPOINT?.trim());
  }

  private canUseAzureOcr(input: OcrExtractionInput) {
    return (
      Boolean(this.azureOcrProvider) &&
      Boolean(input.document.filePath) &&
      Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim()) &&
      Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim())
    );
  }

  private azureProvider() {
    if (!this.azureOcrProvider) {
      throw new Error("Azure Document Intelligence OCR provider is not registered.");
    }

    return this.azureOcrProvider;
  }
}
