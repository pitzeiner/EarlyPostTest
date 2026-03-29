import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getSmtpSettings, resetTransporter } from "../services/email.js";

const smtpBodySchema = z.object({
  host: z.string(),
  port: z.number().int().min(0).max(65535),
  user: z.string(),
  pass: z.string(),
  from: z.string(),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  // All settings routes require admin authorization
  fastify.addHook("onRequest", fastify.authorizeAdmin);

  // GET /api/settings/smtp — get current SMTP configuration
  fastify.get("/smtp", async (_request, reply) => {
    const smtpSettings = await getSmtpSettings();
    return reply.send(smtpSettings ?? {
      host: "",
      port: 587,
      user: "",
      pass: "",
      from: "EarlyPostTest <no-reply@earlyposttest.dev>",
    });
  });

  // PUT /api/settings/smtp — update SMTP configuration
  fastify.put(
    "/smtp",
    {
      schema: {
        body: smtpBodySchema,
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof smtpBodySchema>;

      const now = new Date().toISOString();
      const rows: Array<{ key: string; value: string; updatedAt: string }> = [
        { key: "smtp_host", value: body.host, updatedAt: now },
        { key: "smtp_port", value: String(body.port), updatedAt: now },
        { key: "smtp_user", value: body.user, updatedAt: now },
        { key: "smtp_pass", value: body.pass, updatedAt: now },
        { key: "smtp_from", value: body.from, updatedAt: now },
      ];

      // Upsert each row
      for (const row of rows) {
        await db
          .insert(settings)
          .values(row)
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: row.value, updatedAt: now },
          });
      }

      // Invalidate cached transporter so next send uses new config
      resetTransporter();

      console.log("[settings] SMTP config updated by admin", {
        userId: (request.user as { id: number }).id,
        host: body.host,
        port: body.port,
      });

      // Return the updated config
      return reply.send({
        host: body.host,
        port: body.port,
        user: body.user,
        pass: body.pass,
        from: body.from,
      });
    }
  );
}
