import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { users, loginCodes } from "../db/schema.js";
import { db } from "../db/index.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { sendLoginCodeEmail } from "../services/email.js";
import type {
  RegisterBody,
  RequestCodeBody,
  VerifyCodeBody,
  AuthResponse,
  RequestCodeResponse,
} from "../types.js";

const CODE_LENGTH = 6;
const CODE_EXPIRY_MINUTES = 10;
const MAX_CODE_REQUESTS_PER_HOUR = 5;

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH, "0");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]).optional().default("user"),
});

const requestCodeSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(CODE_LENGTH).regex(/^\d+$/),
});

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post<{ Body: RegisterBody }>(
    "/register",
    {
      schema: {
        body: registerSchema,
      },
    },
    async (request, reply) => {
      const { email, name, role } = request.body;

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (existing) {
        return reply.code(409).send({
          error: "Conflict",
          message: "A user with this email already exists",
        });
      }

      const now = new Date().toISOString();

      const inserted = await db
        .insert(users)
        .values({
          email,
          name,
          role: role ?? "user",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
        .get();

      const token = fastify.jwt.sign({
        id: inserted.id,
        email: inserted.email,
        name: inserted.name,
        role: inserted.role,
      });

      const response: AuthResponse = {
        token,
        user: {
          id: inserted.id,
          email: inserted.email,
          name: inserted.name,
          role: inserted.role as "admin" | "user",
        },
      };

      fastify.log.info({ userId: inserted.id, email, role: inserted.role }, "User registered");
      return reply.code(201).send(response);
    }
  );

  // POST /api/auth/request-code — send a 6-digit login code via email
  fastify.post<{ Body: RequestCodeBody }>(
    "/request-code",
    {
      schema: {
        body: requestCodeSchema,
      },
    },
    async (request, reply) => {
      const { email } = request.body;

      // Rate limit: max N code requests per email per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(loginCodes)
        .where(
          and(
            eq(loginCodes.email, email),
            gte(loginCodes.createdAt, oneHourAgo),
          ),
        )
        .get();

      if ((recentCount?.count ?? 0) >= MAX_CODE_REQUESTS_PER_HOUR) {
        fastify.log.warn({ email: maskEmail(email) }, "Rate limit hit for login code request");
        return reply.code(429).send({
          error: "Too Many Requests",
          message: "Zu viele Anfragen. Bitte warte eine Stunde bevor du einen neuen Code anforderst.",
        });
      }

      // Generate and store the code
      const code = generateCode();
      const expiresAt = new Date(
        Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000,
      ).toISOString();

      await db.insert(loginCodes).values({
        email,
        code,
        expiresAt,
        used: false,
      });

      fastify.log.info({ email: maskEmail(email) }, "Login code generated");

      // Send the email
      const emailSent = await sendLoginCodeEmail(email, code);

      const response: RequestCodeResponse = {
        message: emailSent
          ? "Ein Login-Code wurde an deine E-Mail gesendet."
          : "Code wurde generiert, aber der E-Mail-Versand ist fehlgeschlagen.",
        emailSent,
      };

      return reply.send(response);
    }
  );

  // POST /api/auth/verify-code — verify the code and issue a JWT
  fastify.post<{ Body: VerifyCodeBody }>(
    "/verify-code",
    {
      schema: {
        body: verifyCodeSchema,
      },
    },
    async (request, reply) => {
      const { email, code } = request.body;

      // Find the most recent unused, unexpired code for this email
      const loginCode = await db
        .select()
        .from(loginCodes)
        .where(
          and(
            eq(loginCodes.email, email),
            eq(loginCodes.code, code),
            eq(loginCodes.used, false),
            gte(loginCodes.expiresAt, new Date().toISOString()),
          ),
        )
        .orderBy(sql`${loginCodes.createdAt} DESC`)
        .limit(1)
        .get();

      if (!loginCode) {
        fastify.log.warn({ email: maskEmail(email) }, "Invalid or expired login code");
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Ungültiger oder abgelaufener Code.",
        });
      }

      // Mark code as used
      await db
        .update(loginCodes)
        .set({ used: true })
        .where(eq(loginCodes.id, loginCode.id));

      // Find or create user
      let user = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (!user) {
        const now = new Date().toISOString();
        user = await db
          .insert(users)
          .values({
            email,
            name: email.split("@")[0],
            role: "user",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        fastify.log.info({ userId: user.id, email: maskEmail(email) }, "New user auto-created via magic code login");
      }

      const token = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      const response: AuthResponse = {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as "admin" | "user",
        },
      };

      fastify.log.info({ userId: user.id, email: maskEmail(email) }, "Login code verified");
      return reply.send(response);
    }
  );
}
