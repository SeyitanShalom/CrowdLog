const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OcrDeploymentCheckService,
} = require("../dist/ocr/ocr-deployment-check.service");
const { OcrHealthController } = require("../dist/ocr/ocr-health.controller");

function mockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation?.(...args);
  };

  fn.calls = calls;
  return fn;
}

test("OCR deployment check reports direct PDF readiness without exposing secrets", async () => {
  const previousEnv = snapshotEnv();
  const ocrProvider = {
    name: "configured",
    canReadPdfDirectly: mockFn((input) => {
      assert.equal(input.document.fileType, "application/pdf");
      assert.equal(input.options.pageStart, 1);

      return true;
    }),
  };
  const renderer = {
    isAvailable: mockFn(async () => ({
      available: false,
      reason:
        "spawn pdftoppm ENOENT authorization: Bearer render-secret api-key=renderer-secret",
    })),
  };
  const service = new OcrDeploymentCheckService(ocrProvider, renderer);

  process.env.OCR_PROVIDER = "auto";
  process.env.OCR_FALLBACK_TO_MOCK = "false";
  process.env.OCR_PDF_RENDER_MODE = "auto";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT =
    "https://crowdlog-test.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "azure-secret";
  process.env.AWS_TEXTRACT_REGION = "us-east-1";
  process.env.AWS_TEXTRACT_ACCESS_KEY_ID = "aws-access-secret";
  process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY = "aws-secret-key";
  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID = "crowdlog-project";
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "processor_1";
  process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN = "google-secret";
  process.env.GOOGLE_VISION_API_KEY = "vision-secret";
  process.env.OCR_HTTP_ENDPOINT = "https://ocr-provider.example/extract";
  process.env.OCR_HTTP_DIRECT_PDF = "true";

  try {
    const result = await service.check();
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "ready");
    assert.equal(result.provider.mode, "auto");
    assert.equal(result.provider.selected, "configured");
    assert.equal(result.provider.fallbackToMock, false);
    assert.equal(result.pdf.directPdfSupported, true);
    assert.equal(result.pdf.renderer.available, false);
    assert.equal(result.providers.azure.configured, true);
    assert.equal(result.providers.awsTextract.configured, true);
    assert.equal(result.providers.google.configured, true);
    assert.equal(result.providers.googleVision.configured, true);
    assert.equal(result.providers.http.directPdfReady, true);
    assert.equal(
      result.checks.find((item) => item.name === "google_configuration").status,
      "ready",
    );
    assert.equal(
      result.checks.find((item) => item.name === "aws_textract_configuration")
        .status,
      "ready",
    );
    assert.equal(
      result.checks.find((item) => item.name === "google_vision_configuration")
        .status,
      "ready",
    );
    assert.equal(
      result.checks.find((item) => item.name === "direct_pdf_provider").status,
      "ready",
    );
    assert.equal(
      result.checks.find((item) => item.name === "pdf_extraction_path").status,
      "ready",
    );
    assert.match(serialized, /Bearer \[redacted\]/);
    assert.match(serialized, /api-key=\[redacted\]/);
    assert.doesNotMatch(
      serialized,
      /azure-secret|aws-access-secret|aws-secret-key|google-secret|vision-secret|render-secret|renderer-secret/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("OCR deployment check reports renderer-ready PDF extraction path", async () => {
  const previousEnv = snapshotEnv();
  const ocrProvider = {
    name: "configured",
    canReadPdfDirectly: mockFn(() => false),
  };
  const renderer = {
    isAvailable: mockFn(async () => ({ available: true })),
  };
  const service = new OcrDeploymentCheckService(ocrProvider, renderer);

  delete process.env.OCR_PROVIDER;
  process.env.OCR_FALLBACK_TO_MOCK = "true";
  process.env.OCR_PDF_RENDER_MODE = "render-pages";
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete process.env.AWS_TEXTRACT_REGION;
  delete process.env.AWS_TEXTRACT_ACCESS_KEY_ID;
  delete process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY;
  delete process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_LOCATION;
  delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  delete process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN;
  delete process.env.GOOGLE_VISION_API_KEY;
  delete process.env.GOOGLE_VISION_ACCESS_TOKEN;
  delete process.env.OCR_HTTP_ENDPOINT;
  delete process.env.OCR_HTTP_DIRECT_PDF;

  try {
    const result = await service.check();
    const pathCheck = result.checks.find(
      (item) => item.name === "pdf_extraction_path",
    );

    assert.equal(result.status, "ready");
    assert.equal(result.provider.mode, "auto");
    assert.equal(result.pdf.renderMode, "render-pages");
    assert.equal(result.pdf.renderer.available, true);
    assert.equal(result.pdf.directPdfSupported, false);
    assert.equal(pathCheck.status, "ready");
    assert.match(pathCheck.message, /pdftoppm/);
  } finally {
    restoreEnv(previousEnv);
  }
});

test("OCR health controller returns the deployment check result", async () => {
  const result = { status: "ready", service: "crowdlog-api" };
  const service = {
    check: mockFn(async () => result),
  };
  const controller = new OcrHealthController(service);

  assert.deepEqual(await controller.checkOcrReadiness(), result);
  assert.equal(service.check.calls.length, 1);
});

function snapshotEnv() {
  return {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    OCR_FALLBACK_TO_MOCK: process.env.OCR_FALLBACK_TO_MOCK,
    OCR_PDF_RENDER_MODE: process.env.OCR_PDF_RENDER_MODE,
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    AZURE_DOCUMENT_INTELLIGENCE_KEY:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    AWS_TEXTRACT_REGION: process.env.AWS_TEXTRACT_REGION,
    AWS_TEXTRACT_ACCESS_KEY_ID: process.env.AWS_TEXTRACT_ACCESS_KEY_ID,
    AWS_TEXTRACT_SECRET_ACCESS_KEY: process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    GOOGLE_DOCUMENT_AI_PROJECT_ID: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    GOOGLE_DOCUMENT_AI_ACCESS_TOKEN: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN,
    GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
    GOOGLE_VISION_ACCESS_TOKEN: process.env.GOOGLE_VISION_ACCESS_TOKEN,
    GOOGLE_VISION_ENDPOINT: process.env.GOOGLE_VISION_ENDPOINT,
    OCR_HTTP_ENDPOINT: process.env.OCR_HTTP_ENDPOINT,
    OCR_HTTP_DIRECT_PDF: process.env.OCR_HTTP_DIRECT_PDF,
    OCR_HTTP_INCLUDE_FILE: process.env.OCR_HTTP_INCLUDE_FILE,
  };
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
