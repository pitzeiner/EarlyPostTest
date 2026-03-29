import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { informationEntries } from "../db/schema.js";
import { db } from "../db/index.js";
import { and, eq } from "drizzle-orm";
import type { CreateInformationBody, UpdateInformationBody } from "../types.js";

const createInformationSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
});

const updateInformationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(10000).optional(),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export default async function informationRoutes(fastify: FastifyInstance) {
  // All information routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/information — list information entries for the authenticated user
  fastify.get("/", async (request, reply) => {
    const user = request.user as { id: number };

    const entries = await db
      .select()
      .from(informationEntries)
      .where(eq(informationEntries.createdBy, user.id))
      .all();

    return reply.send(entries);
  });

  // GET /api/information/:id — get a single information entry
  fastify.get<{ Params: { id: number } }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      const entry = await db
        .select()
        .from(informationEntries)
        .where(
          and(
            eq(informationEntries.id, request.params.id),
            eq(informationEntries.createdBy, user.id)
          )
        )
        .get();

      if (!entry) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Information entry not found",
        });
      }

      return reply.send(entry);
    }
  );

  // POST /api/information — create an information entry
  fastify.post<{ Body: CreateInformationBody }>(
    "/",
    {
      schema: {
        body: createInformationSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };
      const { title, content } = request.body;

      const now = new Date().toISOString();

      const inserted = await db
        .insert(informationEntries)
        .values({
          title,
          content,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      fastify.log.info(
        { informationId: inserted.id, userId: user.id },
        "Information entry created"
      );
      return reply.code(201).send(inserted);
    }
  );

  // PUT /api/information/:id — update an information entry
  fastify.put<{ Params: { id: number }; Body: UpdateInformationBody }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
        body: updateInformationSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      // Verify ownership
      const existing = await db
        .select({ id: informationEntries.id })
        .from(informationEntries)
        .where(
          and(
            eq(informationEntries.id, request.params.id),
            eq(informationEntries.createdBy, user.id)
          )
        )
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Information entry not found",
        });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (request.body.title !== undefined) updates.title = request.body.title;
      if (request.body.content !== undefined) updates.content = request.body.content;

      const updated = await db
        .update(informationEntries)
        .set(updates)
        .where(eq(informationEntries.id, request.params.id))
        .returning()
        .get();

      fastify.log.info(
        { informationId: updated.id, userId: user.id },
        "Information entry updated"
      );
      return reply.send(updated);
    }
  );

  // DELETE /api/information/:id — delete an information entry
  fastify.delete<{ Params: { id: number } }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      // Verify ownership
      const existing = await db
        .select({ id: informationEntries.id })
        .from(informationEntries)
        .where(
          and(
            eq(informationEntries.id, request.params.id),
            eq(informationEntries.createdBy, user.id)
          )
        )
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Information entry not found",
        });
      }

      await db
        .delete(informationEntries)
        .where(eq(informationEntries.id, request.params.id));

      fastify.log.info(
        { informationId: request.params.id, userId: user.id },
        "Information entry deleted"
      );
      return reply.code(204).send();
    }
  );
}
