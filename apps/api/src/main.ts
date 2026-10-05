import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureHttpApp } from "./http-config";

async function bootstrap() {
  console.log("Starting CrowdLog API...");
  const app = await NestFactory.create(AppModule);

  configureHttpApp(app);

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  console.log(`CrowdLog API listening on http://localhost:${port}`);
}

void bootstrap().catch((error) => {
  console.error("CrowdLog API failed to start.", error);
  process.exit(1);
});
