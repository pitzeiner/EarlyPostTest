import { CronJob } from "cron";
import { getDigestData } from "./services/digest.js";
import { renderDigestEmail } from "./services/template.js";
import { sendDigestEmail } from "./services/email.js";

const DEFAULT_TIMEZONE = "Europe/Zurich";
const CRON_EXPRESSION = "50 6 * * *"; // 06:50 daily

let job: CronJob | null = null;

/**
 * Execute a single digest run: fetch data, render, send.
 * Logs structured context on success or failure.
 */
async function runDigest(): Promise<void> {
  const runDate = new Date().toISOString();
  console.log("[scheduler] Digest job started", { runDate });

  try {
    const data = await getDigestData();

    if (!data.dutyUser) {
      console.warn("[scheduler] No duty assignment for today, skipping send", {
        runDate,
      });
      return;
    }

    const html = renderDigestEmail(data);
    const subject = `EarlyPost Digest — ${new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}`;

    const sent = await sendDigestEmail(data.dutyUser.email, subject, html);

    if (sent) {
      console.log("[scheduler] Digest email sent successfully", {
        runDate,
        to: data.dutyUser.email,
        dutyUser: data.dutyUser.name,
        taskCount: data.tasks.length,
        infoCount: data.informationEntries.length,
      });
    } else {
      console.error("[scheduler] Digest email send failed", { runDate });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scheduler] Digest job failed", {
      runDate,
      error: message,
    });
  }
}

/**
 * Start the email digest cron scheduler.
 * Fires daily at 06:50 in Europe/Zurich (or EMAIL_TIMEZONE).
 */
export function startScheduler(): void {
  const timezone = process.env.EMAIL_TIMEZONE || DEFAULT_TIMEZONE;

  job = new CronJob(
    CRON_EXPRESSION,
    runDigest,
    null, // onComplete
    true, // start immediately
    timezone,
  );

  console.log(`[scheduler] Email scheduler started: 06:50 ${timezone}`);
}

/**
 * Stop the scheduler (useful for graceful shutdown).
 */
export function stopScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[scheduler] Email scheduler stopped");
  }
}
