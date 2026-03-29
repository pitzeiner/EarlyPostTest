import type { FastifyRequest, FastifyReply } from "fastify";

export interface UserPayload {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: UserPayload;
}

export interface RegisterBody {
  email: string;
  name: string;
  role?: "admin" | "user";
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface RequestCodeBody {
  email: string;
}

export interface VerifyCodeBody {
  email: string;
  code: string;
}

export interface RequestCodeResponse {
  message: string;
  emailSent: boolean;
}

export interface VerifyCodeResponse {
  token: string;
  user: UserPayload;
}

export interface AuthResponse {
  token: string;
  user: UserPayload;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  status?: "open" | "done";
  assignedTo?: number;
  dueDate?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string | null;
  status?: "open" | "done";
  assignedTo?: number | null;
  dueDate?: string | null;
}

export interface CreateDutyAssignmentBody {
  date: string;
  userId: number;
}

export interface UpdateDutyAssignmentBody {
  date?: string;
  userId?: number;
}

export interface CreateInformationBody {
  title: string;
  content: string;
}

export interface UpdateInformationBody {
  title?: string;
  content?: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}
