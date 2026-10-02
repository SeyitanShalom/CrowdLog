import { Inject, Injectable } from "@nestjs/common";
import {
  OCR_PROVIDER,
  type OcrExtractionInput,
  type OcrProvider,
} from "./ocr-provider.interface";
import { PdfPageRenderer } from "./pdf-page-renderer";

type DeploymentCheckStatus = "ready" | "degraded" | "not_configured";
type PdfRenderMode = "auto" | "render-pages" | "full-document";

type DeploymentCheck = {
  name: string;
  status: DeploymentCheckStatus;
  message: string;
};

@Injectable()
export class OcrDeploymentCheckService {
  constructor(
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    private readonly pdfPageRenderer: PdfPageRenderer,
  ) {}

  async check() {
    const providerMode = this.providerMode();
    const renderMode = this.pdfRenderMode();
    const fallbackToMock = process.env.OCR_FALLBACK_TO_MOCK !== "false";
    const renderer = await this.rendererCheck();
    const azure = {
      endpointConfigured: this.hasEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"),
      keyConfigured: this.hasEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY"),
    };
    const http = {
      endpointConfigured: this.hasEnv("OCR_HTTP_ENDPOINT"),
      directPdfEnabled: process.env.OCR_HTTP_DIRECT_PDF === "true",
      includeFile: process.env.OCR_HTTP_INCLUDE_FILE !== "false",
    };
    const directPdfSupported =
      this.ocrProvider.canReadPdfDirectly?.(this.pdfCapabilityInput()) ?? false;
    const pdfExtractionPath = this.pdfExtractionPathStatus({
      directPdfSupported,
      fallbackToMock,
      renderMode,
      rendererAvailable: renderer.available,
    });
    const checks = this.checks({
      azureConfigured: azure.endpointConfigured && azure.keyConfigured,
      directPdfSupported,
      fallbackToMock,
      httpConfigured: http.endpointConfigured,
      httpDirectPdfReady: http.endpointConfigured && http.directPdfEnabled,
      pdfExtractionPath,
      renderMode,
      renderer,
    });

    return {
      status: pdfExtractionPath.status,
      service: "crowdlog-api",
      provider: {
        mode: providerMode,
        selected: this.ocrProvider.name,
        fallbackToMock,
      },
      pdf: {
        renderMode,
        directPdfSupported,
        renderer,
      },
      providers: {
        azure: {
          ...azure,
          configured: azure.endpointConfigured && azure.keyConfigured,
        },
        http: {
          ...http,
          configured: http.endpointConfigured,
          directPdfReady: http.endpointConfigured && http.directPdfEnabled,
        },
      },
      checks,
    };
  }

  private checks({
    azureConfigured,
    directPdfSupported,
    fallbackToMock,
    httpConfigured,
    httpDirectPdfReady,
    pdfExtractionPath,
    renderMode,
    renderer,
  }: {
    azureConfigured: boolean;
    directPdfSupported: boolean;
    fallbackToMock: boolean;
    httpConfigured: boolean;
    httpDirectPdfReady: boolean;
    pdfExtractionPath: DeploymentCheck;
    renderMode: PdfRenderMode;
    renderer: { available: boolean; reason?: string };
  }): DeploymentCheck[] {
    return [
      {
        name: "azure_configuration",
        status: azureConfigured ? "ready" : "not_configured",
        message: azureConfigured
          ? "Azure Document Intelligence endpoint and key are configured."
          : "Azure Document Intelligence is not fully configured.",
      },
      {
        name: "http_configuration",
        status: httpConfigured ? "ready" : "not_configured",
        message: httpConfigured
          ? "Generic HTTP OCR endpoint is configured."
          : "Generic HTTP OCR endpoint is not configured.",
      },
      {
        name: "http_direct_pdf",
        status: httpDirectPdfReady ? "ready" : "not_configured",
        message: httpDirectPdfReady
          ? "Generic HTTP OCR is opted into direct PDF handling."
          : "Generic HTTP OCR is not opted into direct PDF handling.",
      },
      {
        name: "direct_pdf_provider",
        status: directPdfSupported ? "ready" : "not_configured",
        message: directPdfSupported
          ? "The selected OCR provider can read PDFs directly."
          : "The selected OCR provider does not advertise direct PDF support.",
      },
      {
        name: "pdf_renderer",
        status: renderer.available ? "ready" : "not_configured",
        message: renderer.available
          ? "pdftoppm is available for PDF page rendering."
          : `pdftoppm is not available.${renderer.reason ? ` ${renderer.reason}` : ""}`,
      },
      {
        name: "mock_fallback",
        status: fallbackToMock ? "degraded" : "not_configured",
        message: fallbackToMock
          ? "Mock OCR fallback is enabled for recovery, but it is not real OCR."
          : "Mock OCR fallback is disabled.",
      },
      {
        ...pdfExtractionPath,
        message: `${pdfExtractionPath.message} Render mode is ${renderMode}.`,
      },
    ];
  }

  private pdfExtractionPathStatus({
    directPdfSupported,
    fallbackToMock,
    renderMode,
    rendererAvailable,
  }: {
    directPdfSupported: boolean;
    fallbackToMock: boolean;
    renderMode: PdfRenderMode;
    rendererAvailable: boolean;
  }): DeploymentCheck {
    if (renderMode === "full-document") {
      if (directPdfSupported) {
        return {
          name: "pdf_extraction_path",
          status: "ready",
          message: "PDF extraction can use a direct-PDF OCR provider.",
        };
      }

      return {
        name: "pdf_extraction_path",
        status: fallbackToMock ? "degraded" : "not_configured",
        message:
          "Full-document PDF mode is selected, but no direct-PDF provider is advertised.",
      };
    }

    if (directPdfSupported || rendererAvailable) {
      return {
        name: "pdf_extraction_path",
        status: "ready",
        message: directPdfSupported
          ? "PDF extraction can use direct-PDF OCR."
          : "PDF extraction can render pages with pdftoppm.",
      };
    }

    return {
      name: "pdf_extraction_path",
      status: fallbackToMock ? "degraded" : "not_configured",
      message:
        renderMode === "render-pages"
          ? "PDF page rendering is required but pdftoppm is unavailable."
          : "No direct-PDF provider or PDF renderer is available.",
    };
  }

  private async rendererCheck() {
    const result = await this.pdfPageRenderer.isAvailable();

    return result.available
      ? { available: true }
      : {
          available: false,
          reason: result.reason ? this.safeReason(result.reason) : undefined,
        };
  }

  private pdfCapabilityInput(): OcrExtractionInput {
    return {
      document: {
        eventId: "deployment-check",
        fileName: "deployment-check.pdf",
        fileType: "application/pdf",
        fileUrl: "deployment-check://pdf",
        filePath: "deployment-check.pdf",
      },
      template: {
        id: "deployment-check-template",
        name: "Deployment check",
        fields: [],
      },
      options: {
        layout: "table",
        pageStart: 1,
        pageCount: 1,
        totalPages: 1,
      },
    };
  }

  private providerMode() {
    const value = process.env.OCR_PROVIDER?.trim().toLowerCase();

    return value || "auto";
  }

  private pdfRenderMode(): PdfRenderMode {
    const value = process.env.OCR_PDF_RENDER_MODE?.trim().toLowerCase();

    if (value === "render-pages" || value === "full-document") {
      return value;
    }

    return "auto";
  }

  private hasEnv(key: string) {
    return Boolean(process.env[key]?.trim());
  }

  private safeReason(reason: string) {
    return reason
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(
        /(ocp-apim-subscription-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .replace(
        /((?:api[_-]?key|subscription[_-]?key|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .slice(0, 300);
  }
}
