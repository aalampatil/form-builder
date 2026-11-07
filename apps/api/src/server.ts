import express from "express";
import { logger } from "@repo/logger";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";

import * as trpcExpress from "@trpc/server/adapters/express";
import { generateOpenApiDocument, createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { apiReference } from "@scalar/express-api-reference";

import { serverRouter, createContext } from "@repo/trpc/server";

import { env } from "./env";

export const app = express();
app.set("trust proxy", 1);
const openApiDocument = generateOpenApiDocument(serverRouter, {
  title: "Sumikami API",
  version: "1.0.0",
  baseUrl: env.BASE_URL.concat("/api"),
  securitySchemes: { Authorization: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
});

app.use(cors({ origin: env.AUTHORIZED_PARTIES, credentials: true }));

app.use(express.json());

app.get("/", (req, res) => {
  return res.json({ message: "Sumikami API is running" });
});

app.get("/health", (req, res) => {
  return res.json({ message: "Sumikami API is healthy", healthy: true });
});

logger.debug(`openapi.json: ${env.BASE_URL}/openapi.json`);
app.get("/openapi.json", (req, res) => {
  return res.json(openApiDocument);
});

logger.debug(`docs: ${env.BASE_URL}/docs`);
app.use("/docs", apiReference({ url: "/openapi.json" }));

app.use(
  clerkMiddleware({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    authorizedParties: env.AUTHORIZED_PARTIES,
  }),
);
app.use((req, res, next) => {
  if (req.headers.authorization && !getAuth(req).isAuthenticated) {
    res.status(401).json({ error: "Invalid or expired authentication token" });
    return;
  }
  next();
});

app.use(
  "/api",
  createOpenApiExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

app.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

export default app;
