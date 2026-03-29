import type { FastifyInstance } from "fastify";
import { users } from "../db/schema.js";
import { db } from "../db/index.js";

export default async function userRoutes(fastify: FastifyInstance) {
  // All user routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/users — list all users (id, name, email) for dropdowns
  fastify.get("/", async (_request, reply) => {
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .all();

    return reply.send(allUsers);
  });
}
