import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/db/schema.js";
import authPlugin from "../src/plugins/auth.js";
import authRoutes from "../src/routes/auth.js";
import settingsRoutes from "../src/routes/settings.js";

function buildTestServer() {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.register(authPlugin);
  fastify.register(authRoutes, { prefix: "/api/auth" });
  fastify.register(settingsRoutes, { prefix: "/api/settings" });

  return fastify;
}

describe("Settings API", () => {
  let fastify: FastifyInstance;
  let sqlite: Database.Database;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const testDb = drizzle(sqlite, { schema });
    migrate(testDb, { migrationsFolder: "./drizzle" });

    const dbModule = await import("../src/db/index.js");
    Object.defineProperty(dbModule, "db", {
      value: testDb,
      writable: true,
      configurable: true,
    });

    fastify = buildTestServer();
    await fastify.ready();

    // Register an admin user
    const adminReg = await fastify.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      },
    });
    adminToken = adminReg.json().token;

    // Register a regular user
    const userReg = await fastify.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@example.com",
        name: "Regular User",
        role: "user",
      },
    });
    userToken = userReg.json().token;
  });

  afterAll(async () => {
    await fastify.close();
    sqlite.close();
  });

  describe("GET /api/settings/smtp", () => {
    it("returns defaults when no settings exist", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("");
      expect(body.port).toBe(587);
      expect(body.user).toBe("");
      expect(body.pass).toBe("");
      expect(body.from).toBeDefined();
    });

    it("requires authentication", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects non-admin users with 403", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PUT /api/settings/smtp", () => {
    it("updates SMTP config and returns it", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "smtp.example.com",
          port: 465,
          user: "admin@example.com",
          pass: "secret123",
          from: "My App <noreply@example.com>",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("smtp.example.com");
      expect(body.port).toBe(465);
      expect(body.user).toBe("admin@example.com");
      expect(body.pass).toBe("secret123");
      expect(body.from).toBe("My App <noreply@example.com>");
    });

    it("GET returns updated config after PUT", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("smtp.example.com");
      expect(body.port).toBe(465);
    });

    it("rejects non-admin users with 403", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          host: "smtp.evil.com",
          port: 587,
          user: "hacker@evil.com",
          pass: "pwned",
          from: "Hacked",
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects missing fields with 400", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "smtp.example.com",
          // missing port, user, pass, from
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects non-numeric port with 400", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "smtp.example.com",
          port: "not-a-number",
          user: "",
          pass: "",
          from: "",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("accepts empty host (valid for disabling SMTP)", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "",
          port: 587,
          user: "",
          pass: "",
          from: "EarlyPostTest <no-reply@earlyposttest.dev>",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("");
    });

    it("accepts port 0", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "smtp.example.com",
          port: 0,
          user: "",
          pass: "",
          from: "Test",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.port).toBe(0);
    });

    it("accepts port 65535", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          host: "smtp.example.com",
          port: 65535,
          user: "",
          pass: "",
          from: "Test",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.port).toBe(65535);
    });
  });
});
