import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tasks, taskAttachments } from "../db/schema.js";
import { db } from "../db/index.js";
import { and, eq } from "drizzle-orm";
import type { CreateTaskBody, UpdateTaskBody } from "../types.js";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  fastify.addHook("preParsing", fastify.authenticate);

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

  // POST /api/tasks — create a task (with optional attachment via multipart/form-data)
  fastify.post<{ Body: CreateTaskBody }>(
    "/",
    async (request, reply) => {
      const user = request.user as { id: number };

      // Handle multipart form data for file uploads
      let title = "";
      let description: string | undefined;
      let status: "open" | "done" = "open";
      let assignedTo: number | undefined;
      let dueDate: string | undefined;
      let attachmentFile: unknown = null;

      const contentType = request.headers["content-type"] || "";
      
      if (contentType.includes("multipart/form-data")) {
        // Parse multipart form data using parts() iterator
        const parts = request.parts() as AsyncGenerator<{ fieldname: string; value: unknown; type?: string; filename?: string; mimetype?: string; file?: AsyncIterable<Buffer> }>;
        for await (const part of parts) {
          if (part.type === "field") {
            if (part.fieldname === "title" && typeof part.value === "string") {
              title = part.value;
            } else if (part.fieldname === "description" && typeof part.value === "string") {
              description = part.value || undefined;
            } else if (part.fieldname === "status" && typeof part.value === "string") {
              status = part.value === "done" ? "done" : "open";
            } else if (part.fieldname === "assignedTo" && typeof part.value === "string") {
              assignedTo = parseInt(part.value, 10);
            } else if (part.fieldname === "dueDate" && typeof part.value === "string") {
              dueDate = part.value || undefined;
            }
          } else if (part.type === "file") {
            attachmentFile = part;
          }
        }
      } else {
        // Regular JSON request
        const body = request.body as CreateTaskBody;
        title = body.title || "";
        description = body.description;
        status = body.status ?? "open";
        assignedTo = body.assignedTo;
        dueDate = body.dueDate;
      }

      if (!title) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Title is required",
        });
      }

      const now = new Date().toISOString();

      // Insert task first
      const inserted = await db
        .insert(tasks)
        .values({
          title,
          description: description ?? null,
          status: status,
          assignedTo: assignedTo ?? null,
          createdBy: user.id,
          dueDate: dueDate ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      // Handle file attachment if present
      if (attachmentFile && typeof attachmentFile === "object" && "filename" in (attachmentFile as { filename?: unknown })) {
        const fileData = attachmentFile as { filename: string; mimetype?: string; file?: AsyncIterable<Buffer> };
        try {
          const uuid = randomUUID();
          const ext = fileData.filename.split(".").pop() || "";
          const filename = ext ? `${uuid}.${ext}` : uuid;
          const uploadDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "uploads");
          
          await mkdir(uploadDir, { recursive: true });
          
          const filepath = join(uploadDir, filename);
          
          // Collect file buffer
          const chunks: Buffer[] = [];
          if (fileData.file) {
            for await (const chunk of fileData.file) {
              chunks.push(chunk);
            }
          }
          const buffer = Buffer.concat(chunks);
          
          // Check file size (10MB limit)
          if (buffer.length > 10 * 1024 * 1024) {
            fastify.log.warn({ size: buffer.length }, "File too large");
            return reply.code(413).send({
              error: "Payload Too Large",
              message: "File exceeds 10MB limit",
            });
          }
          
          await writeFile(filepath, buffer);

          await db
            .insert(taskAttachments)
            .values({
              taskId: inserted.id,
              filename,
              originalName: fileData.filename,
              mimeType: fileData.mimetype || "application/octet-stream",
              size: buffer.length,
              createdBy: user.id,
              createdAt: now,
            });

          fastify.log.info({ attachmentTaskId: inserted.id, userId: user.id }, "Attachment created with task");
        } catch (err) {
          fastify.log.error({ err }, "Failed to save attachment");
          // Continue - task was created, attachment failed
        }
      }

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

  // GET /api/tasks/:id/attachments — list attachments for a task
  fastify.get<{ Params: { id: number } }>(
    "/:id/attachments",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      // Verify task ownership
      const task = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, request.params.id), eq(tasks.createdBy, user.id)))
        .get();

      if (!task) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      const attachments = await db
        .select()
        .from(taskAttachments)
        .where(eq(taskAttachments.taskId, request.params.id))
        .all();

      return reply.send(attachments);
    }
  );

  // POST /api/tasks/:id/attachments — upload an attachment
  fastify.post<{ Params: { id: number } }>(
    "/:id/attachments",
    {
      schema: {
        params: paramsSchema,
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };

      // Verify task ownership
      const task = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, request.params.id), eq(tasks.createdBy, user.id)))
        .get();

      if (!task) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      const data = await request.file();

      if (!data) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "No file uploaded",
        });
      }

      // Generate unique filename and ensure upload directory exists
      const uuid = randomUUID();
      const ext = data.filename.split(".").pop() || "";
      const filename = ext ? `${uuid}.${ext}` : uuid;
      const uploadDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "uploads");
      
      await mkdir(uploadDir, { recursive: true });
      
      const filepath = join(uploadDir, filename);
      const buffer = await data.toBuffer();
      await writeFile(filepath, buffer);

      const attachment = await db
        .insert(taskAttachments)
        .values({
          taskId: request.params.id,
          filename,
          originalName: data.filename,
          mimeType: data.mimetype || "application/octet-stream",
          size: buffer.length,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();

      fastify.log.info({ attachmentId: attachment.id, taskId: request.params.id, userId: user.id }, "Attachment uploaded");
      return reply.code(201).send(attachment);
    }
  );

  // DELETE /api/tasks/:taskId/attachments/:attachmentId — delete an attachment
  fastify.delete<{ Params: { taskId: number; attachmentId: number } }>(
    "/:taskId/attachments/:attachmentId",
    {
      schema: {
        params: z.object({
          taskId: z.coerce.number().int().positive(),
          attachmentId: z.coerce.number().int().positive(),
        }),
      },
    },
    async (request, reply) => {
      const user = request.user as { id: number };
      const { taskId, attachmentId } = request.params;

      // Verify task ownership
      const task = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.createdBy, user.id)))
        .get();

      if (!task) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Task not found",
        });
      }

      // Verify attachment exists and belongs to this task
      const attachment = await db
        .select()
        .from(taskAttachments)
        .where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, taskId)))
        .get();

      if (!attachment) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Attachment not found",
        });
      }

      // Delete file from filesystem
      try {
        const uploadDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "uploads");
        const filepath = join(uploadDir, attachment.filename);
        const { unlink } = await import("node:fs/promises");
        await unlink(filepath);
      } catch (err) {
        // Log but don't fail - file might already be deleted
        fastify.log.warn({ err, filepath: attachment.filename }, "Failed to delete file");
      }

      // Delete from database
      await db
        .delete(taskAttachments)
        .where(eq(taskAttachments.id, attachmentId));

      fastify.log.info({ attachmentId, taskId, userId: user.id }, "Attachment deleted");
      return reply.code(204).send();
    }
  );
}
