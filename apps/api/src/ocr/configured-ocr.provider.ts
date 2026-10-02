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
type OcrFallbackFailure = {
  provider: string;
  message: string;
};

@Injectable()
export class ConfiguredOcrProvider implements OcrProvider {
  readonly name = "configured";

  constructor(
    private readonly mockOcrProvider: MockOcrProvider,
    private readonly windowsOcrProvider: WindowsOcrProvider,
    private readonly httpOcrProvider: HttpOcrProvider,
    private readonly azureOcrProvider?: AzureDocumentIntelligenceOcrProvider,
  ) {}

  canReadPdfDirectly(input: OcrExtractionInput) {
    if (input.document.fileType !== "application/pdf") {
      return false;
    }

    const mode = this.providerMode();

    if (mode === "azure") {
      return this.azureOcrProvider?.canReadPdfDirectly?.(input) ?? false;
    }

    if (mode === "http") {
      return this.httpOcrProvider.canReadPdfDirectly?.(input) ?? false;
    }

    if (mode !== "auto") {
      return false;
    }

    if (this.canUseAzureOcr(input)) {
      return this.azureOcrProvider?.canReadPdfDirectly?.(input) ?? false;
    }

    if (this.canUseHttpOcr()) {
      return this.httpOcrProvider.canReadPdfDirectly?.(input) ?? false;
    }

    return false;
  }

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

    const fallbackFailures: OcrFallbackFailure[] = [];

    if (this.canUseWindowsOcr(input)) {
      try {
        return await this.windowsOcrProvider.extract(input);
      } catch (error) {
        if (mode === "windows" || process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }

        fallbackFailures.push(
          this.fallbackFailure(this.windowsOcrProvider.name, error),
        );
      }
    }

    if (this.canUseAzureOcr(input)) {
      try {
        return this.withFallbackDiagnostics(
          await this.azureProvider().extract(input),
          fallbackFailures,
        );
      } catch (error) {
        if (process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }

        fallbackFailures.push(
          this.fallbackFailure(this.azureProvider().name, error),
        );
      }
    }

    if (this.canUseHttpOcr()) {
      try {
        return this.withFallbackDiagnostics(
          await this.httpOcrProvider.extract(input),
          fallbackFailures,
        );
      } catch (error) {
        if (process.env.OCR_FALLBACK_TO_MOCK === "false") {
          throw error;
        }

        fallbackFailures.push(
          this.fallbackFailure(this.httpOcrProvider.name, error),
        );
      }
    }

    return this.withFallbackDiagnostics(
      await this.mockOcrProvider.extract(input),
      fallbackFailures,
    );
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

  private withFallbackDiagnostics(
    result: OcrExtractionResult,
    fallbackFailures: OcrFallbackFailure[],
  ): OcrExtractionResult {
    if (fallbackFailures.length === 0) {
      return result;
    }

    return {
      ...result,
      rawOcrJson: {
        provider: "configured-ocr",
        selectedProvider: result.providerName,
        fallbackFailures,
        providerResult: result.rawOcrJson,
      },
    };
  }

  private fallbackFailure(provider: string, error: unknown): OcrFallbackFailure {
    return {
      provider,
      message: this.sanitizedErrorMessage(error),
    };
  }

  private sanitizedErrorMessage(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown OCR provider error.";

    return this.redactSensitiveText(message.replace(/\s+/g, " ").trim()).slice(
      0,
      600,
    );
  }

  private redactSensitiveText(value: string) {
    return value
      .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(
        /(ocp-apim-subscription-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .replace(
        /((?:api[_-]?key|subscription[_-]?key|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      );
  }
}
