import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserPayload } from "../types";

export default fp(async (fastify) => {
  const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-in-production";

  fastify.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: "6 months" },
  });

  // Decorator for route-level auth checking
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: "Unauthorized", message: "Invalid or missing token" });
      }
    }
  );

  // Decorator for admin-only routes
  fastify.decorate(
    "authorizeAdmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: "Unauthorized", message: "Invalid or missing token" });
        return;
      }
      if ((request.user as UserPayload).role !== "admin") {
        reply.code(403).send({ error: "Forbidden", message: "Admin access required" });
      }
    }
  );
});

// Type augmentation for the authenticate decorator
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    authorizeAdmin: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}
