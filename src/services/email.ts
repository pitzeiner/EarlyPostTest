import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { SmtpSettings } from '../types.js';

// SMTP env vars (fallback)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM_ENV = process.env.SMTP_FROM || 'EarlyPostTest <no-reply@earlyposttest.dev>';

let cachedTransporter: Transporter | null = null;
let isEthereal = false;

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'] as const;

/**
 * Read SMTP settings from the database settings table.
 * Returns null if no SMTP settings rows are found.
 */
export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .all();

  const smtpRows = new Map<string, string>();
  for (const row of rows) {
    if (SMTP_KEYS.includes(row.key as typeof SMTP_KEYS[number])) {
      smtpRows.set(row.key, row.value);
    }
  }

  if (smtpRows.size === 0) return null;

  const host = smtpRows.get('smtp_host') ?? '';
  const portStr = smtpRows.get('smtp_port');
  const port = portStr ? parseInt(portStr, 10) : 587;

  return {
    host,
    port,
    user: smtpRows.get('smtp_user') ?? '',
    pass: smtpRows.get('smtp_pass') ?? '',
    from: smtpRows.get('smtp_from') ?? SMTP_FROM_ENV,
  };
}

/**
 * Reset the cached transporter so the next send re-creates it.
 */
export function resetTransporter(): void {
  cachedTransporter = null;
  console.log('[email] Transporter cache reset');
}

/**
 * Create a nodemailer transporter.
 * Priority: DB settings → env vars → Ethereal test account.
 */
export async function createTransporter(): Promise<Transporter> {
  if (cachedTransporter) return cachedTransporter;

  // Try DB settings first
  const dbSettings = await getSmtpSettings();

  const host = dbSettings?.host ?? SMTP_HOST;
  const port = dbSettings?.port ?? SMTP_PORT ?? 587;
  const user = dbSettings?.user ?? SMTP_USER;
  const pass = dbSettings?.pass ?? SMTP_PASS;
  const from = dbSettings?.from ?? SMTP_FROM_ENV;

  // Store the resolved 'from' for use in sendDigestEmail
  resolvedFrom = from;

  if (host) {
    const source = dbSettings?.host ? 'DB' : 'env';
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth:
        user && pass
          ? { user, pass }
          : undefined,
    });
    console.log('[email] SMTP transporter configured', {
      host,
      port,
      source,
    });
    return cachedTransporter;
  }

  // Ethereal fallback — fail fast if the API is unreachable
  const testAccount = await nodemailer.createTestAccount();
  isEthereal = true;
  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  console.log('[email] Using Ethereal test account', {
    user: testAccount.user,
  });
  return cachedTransporter;
}

// Resolved 'from' address (set by createTransporter)
let resolvedFrom: string = SMTP_FROM_ENV;

/**
 * Send a login magic code email.
 *
 * @returns true on success, false on failure
 */
export async function sendLoginCodeEmail(
  to: string,
  code: string,
): Promise<boolean> {
  const subject = 'Dein Login-Code';
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">Login-Code</h2>
      <p>Dein Einmalcode für den Login:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f4; border-radius: 8px; margin: 16px 0;">${code}</p>
      <p style="color: #666; font-size: 14px;">Der Code ist 10 Minuten gültig. Falls du nicht versucht hast dich einzuloggen, kannst du diese E-Mail ignorieren.</p>
    </div>
  `;
  return sendDigestEmail(to, subject, html);
}

/**
 * Send a digest email.
 *
 * @returns true on success, false on failure
 */
export async function sendDigestEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const transporter = await createTransporter();
    const info = await transporter.sendMail({
      from: resolvedFrom,
      to,
      subject,
      html,
    });

    console.log('[email] Message sent', {
      messageId: info.messageId,
      to,
      subject,
    });

    if (isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('[email] Preview URL:', previewUrl);
      }
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send email', {
      to,
      subject,
      error: message,
    });
    return false;
  }
}
