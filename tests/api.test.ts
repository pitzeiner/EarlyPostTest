import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
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
import taskRoutes from "../src/routes/tasks.js";
import informationRoutes from "../src/routes/information.js";
import dutyRoutes from "../src/routes/duty.js";
import userRoutes from "../src/routes/users.js";
import adminRoutes from "../src/routes/admin.js";
import settingsRoutes from "../src/routes/settings.js";
import setupRoutes from "../src/routes/setup.js";

// Create a test server with in-memory SQLite
function buildTestServer(dbInstance: ReturnType<typeof drizzle>) {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Override db import for routes - we use a module-level mock
  fastify.register(authPlugin);
  fastify.register(authRoutes, { prefix: "/api/auth" });
  fastify.register(taskRoutes, { prefix: "/api/tasks" });
  fastify.register(informationRoutes, { prefix: "/api/information" });
  fastify.register(dutyRoutes, { prefix: "/api/duty" });
  fastify.register(userRoutes, { prefix: "/api/users" });
  fastify.register(adminRoutes, { prefix: "/api/admin" });
  fastify.register(settingsRoutes, { prefix: "/api/settings" });
  fastify.register(setupRoutes, { prefix: "/api/setup" });

  return fastify;
}

describe("API Integration Tests", () => {
  let fastify: FastifyInstance;
  let sqlite: Database.Database;
  let token: string;
  let userId: number;

  beforeAll(async () => {
    // Create in-memory SQLite database
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const testDb = drizzle(sqlite, { schema });

    // Run migrations from the drizzle folder
    migrate(testDb, { migrationsFolder: "./drizzle" });

    // Monkey-patch the db module so routes use our test database
    const dbModule = await import("../src/db/index.js");
    Object.defineProperty(dbModule, "db", {
      value: testDb,
      writable: true,
      configurable: true,
    });

    fastify = buildTestServer(testDb);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    sqlite.close();
  });

  // ─── Auth ────────────────────────────────────────────────

  describe("Auth", () => {
    it("POST /api/auth/register creates a user and returns a token", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe("test@example.com");
      expect(body.user.role).toBe("user");
      userId = body.user.id;

      // Verify JWT contains role claim
      const decoded = fastify.jwt.decode<{ id: number; email: string; role: string }>(body.token);
      expect(decoded.role).toBe("user");
    });

    describe("Magic Code Login", () => {
      it("POST /api/auth/request-code sends a code to a registered user", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "test@example.com" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.message).toBeDefined();
        expect(body.emailSent).toBeDefined();
      });

      it("POST /api/auth/request-code sends a code to an unknown email (user auto-created on verify)", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "newuser@example.com" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.message).toBeDefined();
      });

      it("POST /api/auth/request-code rejects invalid email", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "not-an-email" },
        });

        expect(res.statusCode).toBe(400);
      });

      it("POST /api/auth/verify-code returns a JWT for a valid code", async () => {
        // First, request a code
        await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "verify-test@example.com" },
        });

        // Read the code from the database (simulating reading it from email)
        const dbModule = await import("../src/db/index.js");
        const { loginCodes } = await import("../src/db/schema.js");
        const { eq } = await import("drizzle-orm");
        const latestCode = await dbModule.db
          .select()
          .from(loginCodes)
          .where(eq(loginCodes.email, "verify-test@example.com"))
          .orderBy(sql`${loginCodes.createdAt} DESC`)
          .limit(1)
          .get();

        expect(latestCode).toBeDefined();

        // Verify with the code
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: {
            email: "verify-test@example.com",
            code: latestCode!.code,
          },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.token).toBeDefined();
        expect(body.user.email).toBe("verify-test@example.com");
        expect(body.user.name).toBe("verify-test"); // auto-created from email prefix
        expect(body.user.role).toBe("user");

        // Verify JWT is valid
        const decoded = fastify.jwt.decode<{ id: number; email: string; role: string }>(body.token);
        expect(decoded.email).toBe("verify-test@example.com");
        expect(decoded.role).toBe("user");
      });

      // Acquire token for downstream authenticated tests (using the registered test@example.com)
      it("acquires auth token for downstream tests", async () => {
        await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "test@example.com" },
        });

        const dbModule = await import("../src/db/index.js");
        const { loginCodes } = await import("../src/db/schema.js");
        const { eq } = await import("drizzle-orm");
        const latestCode = await dbModule.db
          .select()
          .from(loginCodes)
          .where(eq(loginCodes.email, "test@example.com"))
          .orderBy(sql`${loginCodes.createdAt} DESC`)
          .limit(1)
          .get();

        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: {
            email: "test@example.com",
            code: latestCode!.code,
          },
        });

        expect(res.statusCode).toBe(200);
        token = res.json().token;
      });

      it("POST /api/auth/verify-code returns 401 for an invalid code", async () => {
        await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email: "invalid-code@example.com" },
        });

        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: {
            email: "invalid-code@example.com",
            code: "000000",
          },
        });

        expect(res.statusCode).toBe(401);
      });

      it("POST /api/auth/verify-code rejects already-used code", async () => {
        const email = "reuse-test@example.com";

        // Request a code
        await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email },
        });

        // Read the code
        const dbModule = await import("../src/db/index.js");
        const { loginCodes } = await import("../src/db/schema.js");
        const { eq } = await import("drizzle-orm");
        const latestCode = await dbModule.db
          .select()
          .from(loginCodes)
          .where(eq(loginCodes.email, email))
          .orderBy(sql`${loginCodes.createdAt} DESC`)
          .limit(1)
          .get();

        // Use it once
        await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: { email, code: latestCode!.code },
        });

        // Try to reuse
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: { email, code: latestCode!.code },
        });

        expect(res.statusCode).toBe(401);
      });

      it("POST /api/auth/request-code rate limits after 5 requests per hour", async () => {
        const email = "ratelimit@example.com";

        // Make 5 requests (should all succeed)
        for (let i = 0; i < 5; i++) {
          const res = await fastify.inject({
            method: "POST",
            url: "/api/auth/request-code",
            payload: { email },
          });
          expect(res.statusCode).toBe(200);
        }

        // 6th request should be rate limited
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/request-code",
          payload: { email },
        });

        expect(res.statusCode).toBe(429);
        const body = res.json();
        expect(body.error).toBe("Too Many Requests");
      });

      it("POST /api/auth/verify-code rejects malformed code (non-numeric)", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: {
            email: "test@example.com",
            code: "abcdef",
          },
        });

        expect(res.statusCode).toBe(400);
      });

      it("POST /api/auth/verify-code rejects malformed code (wrong length)", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/auth/verify-code",
          payload: {
            email: "test@example.com",
            code: "1234",
          },
        });

        expect(res.statusCode).toBe(400);
      });
    });
  });

  // ─── Tasks CRUD ──────────────────────────────────────────

  describe("Tasks CRUD", () => {
    let taskId: number;

    it("GET /api/tasks requires authentication", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/tasks",
      });

      expect(res.statusCode).toBe(401);
    });

    it("POST /api/tasks creates a task", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: "Test Task",
          description: "A test task description",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.title).toBe("Test Task");
      expect(body.status).toBe("open");
      taskId = body.id;
    });

    it("GET /api/tasks returns user's tasks", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/tasks",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/tasks/:id returns a single task", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(taskId);
    });

    it("PUT /api/tasks/:id updates a task", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: `/api/tasks/${taskId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "done" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("done");
    });

    it("DELETE /api/tasks/:id removes a task", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: `/api/tasks/${taskId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("GET /api/tasks/:id returns 404 after deletion", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Information Entries CRUD ────────────────────────────

  describe("Information Entries CRUD", () => {
    let informationId: number;

    it("GET /api/information requires authentication", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/information",
      });

      expect(res.statusCode).toBe(401);
    });

    it("POST /api/information creates an entry", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/information",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: "Test Information",
          content: "Some important content here",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.title).toBe("Test Information");
      expect(body.content).toBe("Some important content here");
      informationId = body.id;
    });

    it("GET /api/information returns user's entries", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/information",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/information/:id returns a single entry", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/information/${informationId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(informationId);
    });

    it("PUT /api/information/:id updates an entry", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: `/api/information/${informationId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { title: "Updated Title", content: "Updated content" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("Updated Title");
      expect(body.content).toBe("Updated content");
    });

    it("DELETE /api/information/:id removes an entry", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: `/api/information/${informationId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("GET /api/information/:id returns 404 after deletion", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/information/${informationId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("POST /api/information validates required fields", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/information",
        headers: { authorization: `Bearer ${token}` },
        payload: { title: "" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Duty Schedule CRUD ─────────────────────────────────

  describe("Duty Schedule", () => {
    let dutyId: number;

    it("GET /api/duty requires authentication", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/duty",
      });

      expect(res.statusCode).toBe(401);
    });

    it("POST /api/duty creates a duty assignment", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          date: "2026-03-15",
          userId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.date).toBe("2026-03-15");
      expect(body.userId).toBe(userId);
      dutyId = body.id;
    });

    it("GET /api/duty/:id returns a single assignment", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/duty/${dutyId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(dutyId);
    });

    it("GET /api/duty returns all assignments", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it("PUT /api/duty/:id updates a duty assignment", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: `/api/duty/${dutyId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { date: "2026-03-16" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().date).toBe("2026-03-16");
    });

    it("DELETE /api/duty/:id removes a duty assignment", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: `/api/duty/${dutyId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("GET /api/duty/:id returns 404 after deletion", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/duty/${dutyId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("POST /api/duty rejects duplicate date (unique constraint)", async () => {
      await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: { date: "2026-04-01", userId },
      });

      const res = await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: { date: "2026-04-01", userId },
      });

      expect(res.statusCode).toBe(409);
    });

    it("POST /api/duty rejects non-existent userId (FK violation)", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: { date: "2026-05-01", userId: 99999 },
      });

      expect(res.statusCode).toBe(400);
    });

    it("POST /api/duty rejects malformed date", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/duty",
        headers: { authorization: `Bearer ${token}` },
        payload: { date: "not-a-date", userId },
      });

      expect(res.statusCode).toBe(400);
    });

    it("GET /api/duty/month returns assignments for a month", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/duty/month?year=2026&month=4",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].date).toBe("2026-04-01");
      expect(body[0].userId).toBe(userId);
      expect(body[0].userName).toBe("Test User");
    });

    it("GET /api/duty/month returns empty array when no assignments", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/duty/month?year=2026&month=12",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("DELETE /api/duty/:id returns 404 for non-existent assignment", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: "/api/duty/99999",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Users ──────────────────────────────────────────────

  describe("Users", () => {
    it("GET /api/users requires authentication", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/users",
      });

      expect(res.statusCode).toBe(401);
    });

    it("GET /api/users returns all users", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/users",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      // Each user should have id, name, email, role (no passwordHash)
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("name");
      expect(body[0]).toHaveProperty("email");
      expect(body[0]).toHaveProperty("role");
      expect(["admin", "user"]).toContain(body[0].role);
      expect(body[0]).not.toHaveProperty("passwordHash");
    });
  });

  // ─── Setup Wizard ────────────────────────────────────────

  describe("Setup Wizard", () => {
    // 1. GET /api/setup/status on empty DB → needsSetup: true
    it("GET /api/setup/status returns needsSetup: true when no admin exists", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/setup/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.needsSetup).toBe(true);
    });

    // 2. POST /api/setup creates admin with SMTP config, returns token + user with role='admin'
    it("POST /api/setup creates admin with SMTP config and returns token", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          email: "setup-admin@example.com",
          name: "Setup Admin",
          smtp: {
            host: "smtp.setup.com",
            port: 587,
            user: "setup@setup.com",
            pass: "setup-pass",
            from: "Setup <setup@setup.com>",
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe("setup-admin@example.com");
      expect(body.user.name).toBe("Setup Admin");
      expect(body.user.role).toBe("admin");

      // Verify JWT is valid
      const decoded = fastify.jwt.decode<{ id: number; email: string; role: string }>(body.token);
      expect(decoded.role).toBe("admin");
    });

    // 5. POST /api/setup with SMTP config → settings rows exist in DB
    it("SMTP settings were persisted to DB", async () => {
      const { settings } = await import("../src/db/schema.js");
      const { eq } = await import("drizzle-orm");
      const dbModule = await import("../src/db/index.js");

      const hostSetting = await dbModule.db
        .select()
        .from(settings)
        .where(eq(settings.key, "smtp_host"))
        .get();

      expect(hostSetting).toBeDefined();
      expect(hostSetting!.value).toBe("smtp.setup.com");

      const portSetting = await dbModule.db
        .select()
        .from(settings)
        .where(eq(settings.key, "smtp_port"))
        .get();

      expect(portSetting).toBeDefined();
      expect(portSetting!.value).toBe("587");
    });

    // 3. GET /api/setup/status after admin created → needsSetup: false
    it("GET /api/setup/status returns needsSetup: false after admin created", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/setup/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.needsSetup).toBe(false);
    });

    // 4. POST /api/setup when admin exists → 404
    it("POST /api/setup returns 404 when admin already exists", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          email: "another-admin@example.com",
          name: "Another Admin",
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not Found");
    });

    // 6. POST /api/setup with invalid email → 400
    it("POST /api/setup with invalid email returns 400", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          email: "not-an-email",
          name: "Valid Name",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    // 7. POST /api/setup missing name → 400
    it("POST /api/setup with missing name returns 400", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          email: "valid@example.com",
          name: "",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Admin User Management ───────────────────────────────

  describe("Admin User Management", () => {
    let adminToken: string;
    let adminUserId: number;
    let createdUserId: number;

    it("registers an admin user and acquires token", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.role).toBe("admin");
      adminToken = body.token;
      adminUserId = body.user.id;
    });

    it("non-admin gets 403 on admin endpoints", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Forbidden");
    });

    it("unauthenticated request gets 401", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/admin/users",
      });

      expect(res.statusCode).toBe(401);
    });

    it("admin creates a user (201)", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: "newuser@example.com",
          name: "New User",
          role: "user",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.email).toBe("newuser@example.com");
      expect(body.name).toBe("New User");
      expect(body.role).toBe("user");
      createdUserId = body.id;
    });

    it("admin lists all users", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(3); // test user, admin, new user
    });

    it("duplicate email returns 409", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: "newuser@example.com",
          name: "Duplicate",
          role: "user",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("Conflict");
    });

    it("admin deletes a user", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: `/api/admin/users/${createdUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("deleted user is gone", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const found = body.find((u: { id: number }) => u.id === createdUserId);
      expect(found).toBeUndefined();
    });

    it("admin self-deletion returns 400", async () => {
      const res = await fastify.inject({
        method: "DELETE",
        url: `/api/admin/users/${adminUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Bad Request");
    });
  });

  // ─── Settings (SMTP Config) ─────────────────────────────

  describe("Settings", () => {
    let settingsAdminToken: string;

    it("registers an admin user for settings tests", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "settings-admin@example.com",
          name: "Settings Admin",
          role: "admin",
        },
      });

      expect(res.statusCode).toBe(201);
      settingsAdminToken = res.json().token;
    });

    it("GET /api/settings/smtp as admin returns default config when DB is empty", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("host");
      expect(body).toHaveProperty("port");
      expect(body).toHaveProperty("user");
      expect(body).toHaveProperty("pass");
      expect(body).toHaveProperty("from");
    });

    it("PUT /api/settings/smtp as admin updates and returns config", async () => {
      const smtpConfig = {
        host: "smtp.example.com",
        port: 465,
        user: "admin@example.com",
        pass: "secret-pass-123",
        from: "Test <test@example.com>",
      };

      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
        payload: smtpConfig,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("smtp.example.com");
      expect(body.port).toBe(465);
      expect(body.user).toBe("admin@example.com");
      expect(body.pass).toBe("secret-pass-123");
      expect(body.from).toBe("Test <test@example.com>");
    });

    it("GET /api/settings/smtp returns persisted config after PUT", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.host).toBe("smtp.example.com");
      expect(body.port).toBe(465);
    });

    it("GET /api/settings/smtp as non-admin returns 403", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("PUT /api/settings/smtp as non-admin returns 403", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          host: "smtp.example.com",
          port: 587,
          user: "u",
          pass: "p",
          from: "f",
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it("GET /api/settings/smtp without auth returns 401", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/settings/smtp",
      });

      expect(res.statusCode).toBe(401);
    });

    it("PUT /api/settings/smtp without auth returns 401", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        payload: {
          host: "smtp.example.com",
          port: 587,
          user: "u",
          pass: "p",
          from: "f",
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("PUT /api/settings/smtp with invalid port type returns 400", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
        payload: {
          host: "smtp.example.com",
          port: "not-a-number",
          user: "u",
          pass: "p",
          from: "f",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("PUT /api/settings/smtp with missing fields returns 400", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
        payload: {
          host: "smtp.example.com",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("PUT /api/settings/smtp with all empty strings is accepted", async () => {
      const res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/smtp",
        headers: { authorization: `Bearer ${settingsAdminToken}` },
        payload: {
          host: "",
          port: 587,
          user: "",
          pass: "",
          from: "",
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
