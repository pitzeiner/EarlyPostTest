import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tasks } from "../db/schema.js";
import { db } from "../db/index.js";
import { and, eq } from "drizzle-orm";
import type { CreateTaskBody, UpdateTaskBody } from "../types.js";

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["open", "done"]).optional().default("open"),
  assignedTo: z.number().int().positive().optional(),
  dueDate: z.string().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["open", "done"]).optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export default async function taskRoutes(fastify: FastifyInstance) {
  // All task routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/tasks — list tasks for the authenticated user
  fastify.get("/", async (request, reply) => {
    const user = request.user as { id: number };

    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.createdBy, user.id))
      .all();

    return reply.send(userTasks);
  });

  // GET /api/tasks/:id — get a single task
  fastify.get<{ Params: { id: number } }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      const task = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, request.params.id), eq(tasks.createdBy, user.id)))
        .get();

      if (!task) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      return reply.send(task);
    }
  );

  // POST /api/tasks — create a task
  fastify.post<{ Body: CreateTaskBody }>(
    "/",
    {
      schema: {
        body: createTaskSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };
      const { title, description, status, assignedTo, dueDate } = request.body;

      const now = new Date().toISOString();

      const inserted = await db
        .insert(tasks)
        .values({
          title,
          description: description ?? null,
          status: status ?? "open",
          assignedTo: assignedTo ?? null,
          createdBy: user.id,
          dueDate: dueDate ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      fastify.log.info({ taskId: inserted.id, userId: user.id }, "Task created");
      return reply.code(201).send(inserted);
    }
  );

  // PUT /api/tasks/:id — update a task
  fastify.put<{ Params: { id: number }; Body: UpdateTaskBody }>(
    "/:id",
    {
      schema: {
        params: paramsSchema,
        body: updateTaskSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      // Verify ownership
      const existing = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, request.params.id), eq(tasks.createdBy, user.id)))
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (request.body.title !== undefined) updates.title = request.body.title;
      if (request.body.description !== undefined) updates.description = request.body.description;
      if (request.body.status !== undefined) updates.status = request.body.status;
      if (request.body.assignedTo !== undefined) updates.assignedTo = request.body.assignedTo;
      if (request.body.dueDate !== undefined) updates.dueDate = request.body.dueDate;

      const updated = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, request.params.id))
        .returning()
        .get();

      fastify.log.info({ taskId: updated.id, userId: user.id }, "Task updated");
      return reply.send(updated);
    }
  );

  // DELETE /api/tasks/:id — delete a task
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
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, request.params.id), eq(tasks.createdBy, user.id)))
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      await db
        .delete(tasks)
        .where(eq(tasks.id, request.params.id));

      fastify.log.info({ taskId: request.params.id, userId: user.id }, "Task deleted");
      return reply.code(204).send();
    }
  );
}
