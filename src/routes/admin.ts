import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../db/schema.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { UserPayload } from "../types.js";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]),
});

const deleteUserParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export default async function adminRoutes(fastify: FastifyInstance) {
  // All admin routes require admin authorization
  fastify.addHook("onRequest", fastify.authorizeAdmin);

  // POST /api/admin/users — create a new user
  fastify.post(
    "/users",
    {
      schema: {
        body: createUserSchema,
      },
    },
    async (request, reply) => {
      const { email, name, role } = request.body as z.infer<typeof createUserSchema>;

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
          role,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
        .get();

      fastify.log.info({ userId: inserted.id, email, role }, "Admin created user");
      return reply.code(201).send(inserted);
    }
  );

  // GET /api/admin/users — list all users
  fastify.get("/users", async (_request, reply) => {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .all();

    return reply.send(allUsers);
  });

  // DELETE /api/admin/users/:id — delete a user by id
  fastify.delete(
    "/users/:id",
    {
      schema: {
        params: deleteUserParamsSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof deleteUserParamsSchema>;
      const adminUser = request.user as UserPayload;

      if (id === adminUser.id) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Cannot delete your own account",
        });
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .get();

      if (!existing) {
        return reply.code(404).send({
          error: "Not Found",
          message: "User not found",
        });
      }

      await db.delete(users).where(eq(users.id, id));

      fastify.log.info({ deletedUserId: id, byAdmin: adminUser.id }, "Admin deleted user");
      return reply.code(204).send();
    }
  );
}
