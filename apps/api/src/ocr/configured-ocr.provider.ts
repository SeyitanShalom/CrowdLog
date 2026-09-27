import { Injectable } from "@nestjs/common";
import type {
  OcrExtractionInput,
  OcrExtractionResult,
  OcrProvider,
} from "./ocr-provider.interface";
import { MockOcrProvider } from "./mock-ocr.provider";
import { WindowsOcrProvider } from "./windows-ocr.provider";

type OcrProviderMode = "auto" | "mock" | "windows";

@Injectable()
export class ConfiguredOcrProvider implements OcrProvider {
  readonly name = "configured";

  constructor(
    private readonly mockOcrProvider: MockOcrProvider,
    private readonly windowsOcrProvider: WindowsOcrProvider,
  ) {}

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const mode = this.providerMode();

    if (mode === "mock") {
      return this.mockOcrProvider.extract(input);
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

    return this.mockOcrProvider.extract(input);
  }

  private providerMode(): OcrProviderMode {
    const value = process.env.OCR_PROVIDER?.toLowerCase();

    if (value === "mock" || value === "windows") {
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
}
