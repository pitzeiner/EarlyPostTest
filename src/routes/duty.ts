import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dutyAssignments, users } from "../db/schema.js";
import { db } from "../db/index.js";
import { and, eq, between, sql } from "drizzle-orm";
import type { CreateDutyAssignmentBody, UpdateDutyAssignmentBody } from "../types.js";

const createDutySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  userId: z.number().int().positive(),
});

const updateDutySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  userId: z.number().int().positive().optional(),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export default async function dutyRoutes(fastify: FastifyInstance) {
  // All duty routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/duty — list all duty assignments
  fastify.get("/", async (_request, reply) => {
    const assignments = await db
      .select()
      .from(dutyAssignments)
      .all();

    return reply.send(assignments);
  });

  // GET /api/duty/month?year=YYYY&month=MM — query assignments by month
  fastify.get<{ Querystring: { year: string; month: string } }>(
    "/month",
    {
      schema: {
        querystring: monthQuerySchema,
      },
    },
    async (request, reply) => {
      const { year, month } = request.query;

      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const assignments = await db
        .select({
          id: dutyAssignments.id,
          date: dutyAssignments.date,
          userId: dutyAssignments.userId,
          userName: users.name,
        })
        .from(dutyAssignments)
        .leftJoin(users, eq(dutyAssignments.userId, users.id))
        .where(between(dutyAssignments.date, startDate, endDate))
        .all();

      return reply.send(assignments);
    }
  );

  // GET /api/duty/:id — get a single duty assignment
  fastify.get<{ Params: { id: number } }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const assignment = await db
        .select()
        .from(dutyAssignments)
        .where(eq(dutyAssignments.id, request.params.id))
        .get();

      if (!assignment) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Duty assignment not found",
        });
      }

      return reply.send(assignment);
    }
  );

  // POST /api/duty — create a duty assignment
  fastify.post<{ Body: CreateDutyAssignmentBody }>(
    "/",
    {
      schema: {
        body: createDutySchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };
      const { date, userId } = request.body;

      try {
        const now = new Date().toISOString();

        const inserted = await db
          .insert(dutyAssignments)
          .values({
            date,
            userId,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();

        fastify.log.info({ dutyId: inserted.id, date, userId }, "Duty assignment created");
        return reply.code(201).send(inserted);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("UNIQUE constraint failed")) {
          return reply.code(409).send({
            error: "Conflict",
            message: `A duty assignment already exists for date ${date}`,
          });
        }
        if (msg.includes("FOREIGN KEY constraint failed")) {
          return reply.code(400).send({
            error: "Bad Request",
            message: "Referenced user does not exist",
          });
        }
        throw err;
      }
    }
  );

  // PUT /api/duty/:id — update a duty assignment
  fastify.put<{ Params: { id: number }; Body: UpdateDutyAssignmentBody }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
        body: updateDutySchema,
      },
    },
    async (request, reply) => {
      const existing = await db
        .select({ id: dutyAssignments.id })
        .from(dutyAssignments)
        .where(eq(dutyAssignments.id, request.params.id))
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Duty assignment not found",
        });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (request.body.date !== undefined) updates.date = request.body.date;
      if (request.body.userId !== undefined) updates.userId = request.body.userId;

      try {
        const updated = await db
          .update(dutyAssignments)
          .set(updates)
          .where(eq(dutyAssignments.id, request.params.id))
          .returning()
          .get();

        fastify.log.info({ dutyId: updated.id }, "Duty assignment updated");
        return reply.send(updated);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("UNIQUE constraint failed")) {
          return reply.code(409).send({
            error: "Conflict",
            message: "A duty assignment already exists for this date",
          });
        }
        throw err;
      }
    }
  );

  // DELETE /api/duty/:id — delete a duty assignment
  fastify.delete<{ Params: { id: number } }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const existing = await db
        .select({ id: dutyAssignments.id })
        .from(dutyAssignments)
        .where(eq(dutyAssignments.id, request.params.id))
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Duty assignment not found",
        });
      }

      await db
        .delete(dutyAssignments)
        .where(eq(dutyAssignments.id, request.params.id));

      fastify.log.info({ dutyId: request.params.id }, "Duty assignment deleted");
      return reply.code(204).send();
    }
  );
}
