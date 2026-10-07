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
    const awsTextract = {
      accessKeyConfigured:
        this.hasEnv("AWS_TEXTRACT_ACCESS_KEY_ID") ||
        this.hasEnv("AWS_ACCESS_KEY_ID"),
      secretKeyConfigured:
        this.hasEnv("AWS_TEXTRACT_SECRET_ACCESS_KEY") ||
        this.hasEnv("AWS_SECRET_ACCESS_KEY"),
      regionConfigured:
        this.hasEnv("AWS_TEXTRACT_REGION") ||
        this.hasEnv("AWS_REGION") ||
        this.hasEnv("AWS_DEFAULT_REGION"),
      endpointConfigured: this.hasEnv("AWS_TEXTRACT_ENDPOINT"),
    };
    const google = {
      projectConfigured: this.hasEnv("GOOGLE_DOCUMENT_AI_PROJECT_ID"),
      locationConfigured: this.hasEnv("GOOGLE_DOCUMENT_AI_LOCATION"),
      processorConfigured: this.hasEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID"),
      accessTokenConfigured: this.hasEnv("GOOGLE_DOCUMENT_AI_ACCESS_TOKEN"),
    };
    const googleVision = {
      apiKeyConfigured: this.hasEnv("GOOGLE_VISION_API_KEY"),
      accessTokenConfigured: this.hasEnv("GOOGLE_VISION_ACCESS_TOKEN"),
      endpointConfigured: this.hasEnv("GOOGLE_VISION_ENDPOINT"),
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
      awsTextractConfigured:
        awsTextract.accessKeyConfigured &&
        awsTextract.secretKeyConfigured &&
        awsTextract.regionConfigured,
      directPdfSupported,
      fallbackToMock,
      googleConfigured:
        google.projectConfigured &&
        google.locationConfigured &&
        google.processorConfigured &&
        google.accessTokenConfigured,
      googleVisionConfigured:
        googleVision.apiKeyConfigured || googleVision.accessTokenConfigured,
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
        awsTextract: {
          ...awsTextract,
          configured:
            awsTextract.accessKeyConfigured &&
            awsTextract.secretKeyConfigured &&
            awsTextract.regionConfigured,
        },
        google: {
          ...google,
          configured:
            google.projectConfigured &&
            google.locationConfigured &&
            google.processorConfigured &&
            google.accessTokenConfigured,
        },
        googleVision: {
          ...googleVision,
          configured:
            googleVision.apiKeyConfigured ||
            googleVision.accessTokenConfigured,
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
    awsTextractConfigured,
    directPdfSupported,
    fallbackToMock,
    googleConfigured,
    googleVisionConfigured,
    httpConfigured,
    httpDirectPdfReady,
    pdfExtractionPath,
    renderMode,
    renderer,
  }: {
    azureConfigured: boolean;
    awsTextractConfigured: boolean;
    directPdfSupported: boolean;
    fallbackToMock: boolean;
    googleConfigured: boolean;
    googleVisionConfigured: boolean;
    httpConfigured: boolean;
    httpDirectPdfReady: boolean;
    pdfExtractionPath: DeploymentCheck;
    renderMode: PdfRenderMode;
    renderer: { available: boolean; reason?: string };
  }): DeploymentCheck[] {
    return [
      {
        name: "ocr_accuracy_provider",
        status:
          azureConfigured ||
          awsTextractConfigured ||
          googleConfigured ||
          googleVisionConfigured ||
          httpConfigured
            ? "ready"
            : "degraded",
        message:
          azureConfigured ||
          awsTextractConfigured ||
          googleConfigured ||
          googleVisionConfigured ||
          httpConfigured
            ? "A real OCR provider is configured for higher-accuracy extraction."
            : "No cloud or HTTP OCR provider is configured; auto mode may use local Windows OCR or mock fallback, which is lower accuracy.",
      },
      {
        name: "azure_configuration",
        status: azureConfigured ? "ready" : "not_configured",
        message: azureConfigured
          ? "Azure Document Intelligence endpoint and key are configured."
          : "Azure Document Intelligence is not fully configured.",
      },
      {
        name: "aws_textract_configuration",
        status: awsTextractConfigured ? "ready" : "not_configured",
        message: awsTextractConfigured
          ? "AWS Textract credentials and region are configured."
          : "AWS Textract access key, secret key, or region is not configured.",
      },
      {
        name: "http_configuration",
        status: httpConfigured ? "ready" : "not_configured",
        message: httpConfigured
          ? "Generic HTTP OCR endpoint is configured."
          : "Generic HTTP OCR endpoint is not configured.",
      },
      {
        name: "google_configuration",
        status: googleConfigured ? "ready" : "not_configured",
        message: googleConfigured
          ? "Google Document AI project, location, processor, and access token are configured."
          : "Google Document AI is not fully configured.",
      },
      {
        name: "google_vision_configuration",
        status: googleVisionConfigured ? "ready" : "not_configured",
        message: googleVisionConfigured
          ? "Google Vision API authentication is configured."
          : "Google Vision API key or access token is not configured.",
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
      .replace(
        /((?:aws[_-]?)?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        "$1[redacted]",
      )
      .slice(0, 300);
  }
}
