import { Controller, Get } from "@nestjs/common";
import { OcrDeploymentCheckService } from "./ocr-deployment-check.service";

@Controller()
export class OcrHealthController {
  constructor(private readonly deploymentCheck: OcrDeploymentCheckService) {}

  @Get("health/ocr")
  checkOcrReadiness() {
    return this.deploymentCheck.check();
  }
}
