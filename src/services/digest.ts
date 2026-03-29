import { db } from "../db/index.js";
import { dutyAssignments, tasks, informationEntries, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

export interface DigestData {
  dutyUser: { name: string; email: string } | null;
  tasks: Array<{
    id: number;
    title: string;
    description: string | null;
    createdBy: number;
    createdAt: string;
  }>;
  informationEntries: Array<{
    id: number;
    title: string;
    content: string;
    createdBy: number;
    createdAt: string;
  }>;
}

/**
 * Get today's date in Europe/Zurich timezone as YYYY-MM-DD.
 */
function todayInZurich(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Assemble all data needed for the morning email digest:
 * - Today's duty assignment (with user name + email)
 * - All open tasks
 * - All information entries
 *
 * @param date - YYYY-MM-DD string, defaults to today in Europe/Zurich
 */
export async function getDigestData(date?: string): Promise<DigestData> {
  const targetDate = date ?? todayInZurich();

  // Duty assignment joined with user for name + email
  const dutyRow = await db
    .select({
      name: users.name,
      email: users.email,
    })
    .from(dutyAssignments)
    .innerJoin(users, eq(dutyAssignments.userId, users.id))
    .where(eq(dutyAssignments.date, targetDate))
    .get();

  // All open tasks
  const openTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      createdBy: tasks.createdBy,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.status, "open"))
    .all();

  // All information entries
  const entries = await db
    .select({
      id: informationEntries.id,
      title: informationEntries.title,
      content: informationEntries.content,
      createdBy: informationEntries.createdBy,
      createdAt: informationEntries.createdAt,
    })
    .from(informationEntries)
    .all();

  return {
    dutyUser: dutyRow ? { name: dutyRow.name, email: dutyRow.email } : null,
    tasks: openTasks,
    informationEntries: entries,
  };
}
