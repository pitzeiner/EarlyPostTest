import type { FastifyInstance } from "fastify";
import { getDigestData } from "../services/digest.js";
import { renderDigestEmail } from "../services/template.js";
import { sendDigestEmail } from "../services/email.js";

export default async function emailRoutes(fastify: FastifyInstance) {
  // All email routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // POST /api/email/send — trigger digest email send
  fastify.post("/send", async (request, reply) => {
    try {
      const data = await getDigestData();

      if (!data.dutyUser) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Keine Dienstzuweisung für heute gefunden.",
        });
      }

      const html = renderDigestEmail(data);
      const subject = `EarlyPost Digest — ${data.dutyUser.name}`;

      const sent = await sendDigestEmail(data.dutyUser.email, subject, html);

      if (!sent) {
        return reply.code(502).send({
          error: "Bad Gateway",
          message: "E-Mail konnte nicht gesendet werden.",
        });
      }

      fastify.log.info(
        { dutyUser: data.dutyUser.name, taskCount: data.tasks.length, infoCount: data.informationEntries.length },
        "Digest email sent",
      );

      return reply.send({
        success: true,
        dutyUser: data.dutyUser.name,
        taskCount: data.tasks.length,
        infoCount: data.informationEntries.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.error({ error: message }, "Failed to send digest email");
      return reply.code(500).send({
        error: "Internal Server Error",
        message: "Fehler beim Versand des Digests.",
      });
    }
  });
}
