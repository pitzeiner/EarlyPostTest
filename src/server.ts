import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import taskRoutes from "./routes/tasks.js";
import informationRoutes from "./routes/information.js";
import dutyRoutes from "./routes/duty.js";
import emailRoutes from "./routes/email.js";
import userRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";
import settingsRoutes from "./routes/settings.js";
import setupRoutes from "./routes/setup.js";
import { startScheduler } from "./scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const indexHtml = readFileSync(join(publicDir, "index.html"), "utf-8");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

export function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // Zod validation and serialization
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Register plugins
  fastify.register(authPlugin);

  // Serve static files from public/ with SPA fallback
  fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    decorateReply: false,
  });

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  // Auth routes under /api/auth
  fastify.register(authRoutes, { prefix: "/api/auth" });

  // Task routes under /api/tasks
  fastify.register(taskRoutes, { prefix: "/api/tasks" });

  // Information routes under /api/information
  fastify.register(informationRoutes, { prefix: "/api/information" });

  // Duty routes under /api/duty
  fastify.register(dutyRoutes, { prefix: "/api/duty" });

  // Email routes under /api/email
  fastify.register(emailRoutes, { prefix: "/api/email" });

  // User routes under /api/users
  fastify.register(userRoutes, { prefix: "/api/users" });

  // Admin routes under /api/admin
  fastify.register(adminRoutes, { prefix: "/api/admin" });

  // Settings routes under /api/settings
  fastify.register(settingsRoutes, { prefix: "/api/settings" });

  // Setup routes under /api/setup
  fastify.register(setupRoutes, { prefix: "/api/setup" });

  // SPA fallback — serve index.html for non-API routes
  fastify.setNotFoundHandler((request, reply) => {
    // Return 204 for favicon to avoid noise
    if (request.url === "/favicon.ico") {
      return reply.code(204).send();
    }
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.type("text/html").send(indexHtml);
    }
    return reply.code(404).send({ error: "Not Found", message: "Route not found" });
  });

  return fastify;
}

export async function startServer() {
  const fastify = buildServer();

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on ${HOST}:${PORT}`);

    // Start cron scheduler after server is listening
    startScheduler();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
