import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users, settings } from "../db/schema.js";
import { db } from "../db/index.js";
import { eq, count } from "drizzle-orm";

const setupBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  smtp: z
    .object({
      host: z.string(),
      port: z.number().int().min(0).max(65535),
      user: z.string(),
      pass: z.string(),
      from: z.string(),
    })
    .optional(),
});

export default async function setupRoutes(fastify: FastifyInstance) {
  // GET /api/setup/status — check if setup is needed (no auth required)
  fastify.get("/status", async (_request, reply) => {
    const result = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, "admin"))
      .get();

    return reply.send({ needsSetup: (result?.count ?? 0) === 0 });
  });

  // POST /api/setup — create first admin and optional SMTP config (no auth required)
  fastify.post(
    "/",
    {
      schema: {
        body: setupBodySchema,
      },
    },
    async (request, reply) => {
      const { email, name, smtp } = request.body as z.infer<typeof setupBodySchema>;

      // Check if admin already exists — setup is one-shot
      const adminCheck = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, "admin"))
        .get();

      if ((adminCheck?.count ?? 0) > 0) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Setup already completed",
        });
      }

      // Insert admin user
      const now = new Date().toISOString();
      const inserted = await db
        .insert(users)
        .values({
          email,
          name,
          role: "admin",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
        .get();

      console.log("[setup] Admin account created", {
        userId: inserted.id,
        email: inserted.email,
      });

      // Upsert SMTP settings if provided
      if (smtp) {
        const rows = [
          { key: "smtp_host", value: smtp.host },
          { key: "smtp_port", value: String(smtp.port) },
          { key: "smtp_user", value: smtp.user },
          { key: "smtp_pass", value: smtp.pass },
          { key: "smtp_from", value: smtp.from },
        ];

        for (const row of rows) {
          await db
            .insert(settings)
            .values(row)
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: row.value, updatedAt: now },
            });
        }
      }

      // Generate JWT
      const token = fastify.jwt.sign({
        id: inserted.id,
        email: inserted.email,
        name: inserted.name,
        role: inserted.role,
      });

      return reply.code(201).send({
        token,
        user: {
          id: inserted.id,
          email: inserted.email,
          name: inserted.name,
          role: inserted.role,
        },
      });
    }
  );
}
