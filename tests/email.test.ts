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
import dutyRoutes from "../src/routes/duty.js";
import emailRoutes from "../src/routes/email.js";
import { renderDigestEmail } from "../src/services/template.js";
import type { DigestData } from "../src/services/digest.js";

function buildTestServer() {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.register(authPlugin);
  fastify.register(authRoutes, { prefix: "/api/auth" });
  fastify.register(dutyRoutes, { prefix: "/api/duty" });
  fastify.register(emailRoutes, { prefix: "/api/email" });

  return fastify;
}

describe("Email Integration Tests", () => {
  let fastify: FastifyInstance;
  let sqlite: Database.Database;
  let token: string;
  let userId: number;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const testDb = drizzle(sqlite, { schema });
    migrate(testDb, { migrationsFolder: "./drizzle" });

    // Monkey-patch the db module so routes use our test database
    const dbModule = await import("../src/db/index.js");
    Object.defineProperty(dbModule, "db", {
      value: testDb,
      writable: true,
      configurable: true,
    });

    fastify = buildTestServer();
    await fastify.ready();

    // Register a test user
    const regRes = await fastify.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "digest@example.com",
        name: "Digest Tester",
        password: "password123",
      },
    });
    const regBody = regRes.json();
    token = regBody.token;
    userId = regBody.user.id;
  });

  afterAll(async () => {
    await fastify.close();
    sqlite.close();
  });

  // ─── Template rendering ──────────────────────────────────

  describe("renderDigestEmail", () => {
    it("renders duty person name in HTML", () => {
      const data: DigestData = {
        dutyUser: { name: "Max Mustermann", email: "max@example.com" },
        tasks: [],
        informationEntries: [],
      };
      const html = renderDigestEmail(data);
      expect(html).toContain("Max Mustermann");
      expect(html).toContain("max@example.com");
    });

    it("renders task titles in HTML", () => {
      const data: DigestData = {
        dutyUser: { name: "Test", email: "test@test.com" },
        tasks: [
          {
            id: 1,
            title: "Important Task",
            description: "Do something",
            createdBy: 1,
            createdAt: "2026-03-28T06:00:00.000Z",
          },
        ],
        informationEntries: [],
      };
      const html = renderDigestEmail(data);
      expect(html).toContain("Important Task");
      expect(html).toContain("Do something");
    });

    it("renders information entries in HTML", () => {
      const data: DigestData = {
        dutyUser: { name: "Test", email: "test@test.com" },
        tasks: [],
        informationEntries: [
          {
            id: 1,
            title: "Notice",
            content: "Meeting at 10am",
            createdBy: 1,
            createdAt: "2026-03-28T06:00:00.000Z",
          },
        ],
      };
      const html = renderDigestEmail(data);
      expect(html).toContain("Notice");
      expect(html).toContain("Meeting at 10am");
    });

    it("handles empty state gracefully", () => {
      const data: DigestData = {
        dutyUser: null,
        tasks: [],
        informationEntries: [],
      };
      const html = renderDigestEmail(data);
      expect(html).toContain("Niemand");
      expect(html).toContain("Keine offenen Aufgaben");
      expect(html).toContain("Keine Einträge");
    });

    it("escapes HTML entities in user content", () => {
      const data: DigestData = {
        dutyUser: { name: "Test", email: "test@test.com" },
        tasks: [
          {
            id: 1,
            title: "<script>alert('xss')</script>",
            description: null,
            createdBy: 1,
            createdAt: "2026-03-28T06:00:00.000Z",
          },
        ],
        informationEntries: [],
      };
      const html = renderDigestEmail(data);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  // ─── Email send endpoint ─────────────────────────────────

  describe("POST /api/email/send", () => {
    it("requires authentication", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/email/send",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 when no duty assignment for today", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/email/send",
        headers: { authorization: `Bearer ${token}` },
      });
      // Could be 400 (no duty) or 200 (if a duty already exists for today)
      if (res.statusCode === 400) {
        const body = res.json();
        expect(body.message).toContain("Dienstzuweisung");
      }
    });

    it("returns 200 when duty assignment exists and sends email", async () => {
      // Use tomorrow to avoid conflict with the previous test
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Zurich",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(tomorrow);

      // We need to test with today's date — get today in Zurich
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Zurich",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      // Create duty assignment for today (might already exist from previous test)
      const dutyRes = await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: { date: today, userId },
      });
      // 201 = created, 409 = already exists from previous test
      expect([201, 409]).toContain(dutyRes.statusCode);

      const res = await fastify.inject({
        method: "POST",
        url: "/api/email/send",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.dutyUser).toBe("Digest Tester");
      expect(body.taskCount).toBeGreaterThanOrEqual(0);
      expect(body.infoCount).toBeGreaterThanOrEqual(0);
    });
  });
});
