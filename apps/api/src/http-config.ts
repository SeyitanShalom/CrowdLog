import { ValidationPipe, type INestApplication } from "@nestjs/common";

export function configureHttpApp(app: INestApplication) {
  const allowedOrigins = allowedCorsOrigins();

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`), false);
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

function allowedCorsOrigins() {
  const configuredOrigins =
    process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? "";
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0
    ? origins
    : ["http://localhost:3000", "http://localhost:3001"];
}
