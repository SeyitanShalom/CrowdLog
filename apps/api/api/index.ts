import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module";
import { configureHttpApp } from "../src/http-config";

let cachedServer: any;

async function createServer() {
  const express = require("express");
  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  configureHttpApp(app);
  await app.init();

  return expressApp;
}

export default async function handler(request: any, response: any) {
  cachedServer = cachedServer ?? (await createServer());

  return cachedServer(request, response);
}
