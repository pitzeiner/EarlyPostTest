import type { DigestData } from "./digest.js";

/**
 * Render a digest email as an HTML string with inline CSS for email client compatibility.
 */
export function renderDigestEmail(data: DigestData): string {
  const dutyName = data.dutyUser?.name ?? "Niemand";
  const dutyEmail = data.dutyUser?.email ?? "";

  const tasksHtml =
    data.tasks.length === 0
      ? `<p style="color:#6b7280;font-style:italic;">Keine offenen Aufgaben.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          ${data.tasks
            .map(
              (t) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                <strong style="color:#111827;font-size:14px;">${escapeHtml(t.title)}</strong>
                ${t.description ? `<br/><span style="color:#4b5563;font-size:13px;">${escapeHtml(t.description)}</span>` : ""}
                <br/><span style="color:#9ca3af;font-size:12px;">Erstellt am ${formatDate(t.createdAt)}</span>
              </td>
            </tr>`,
            )
            .join("")}
        </table>`;

  const infoHtml =
    data.informationEntries.length === 0
      ? `<p style="color:#6b7280;font-style:italic;">Keine Einträge.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          ${data.informationEntries
            .map(
              (e) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                <strong style="color:#111827;font-size:14px;">${escapeHtml(e.title)}</strong>
                <br/><span style="color:#4b5563;font-size:13px;">${escapeHtml(e.content)}</span>
                <br/><span style="color:#9ca3af;font-size:12px;">Erstellt am ${formatDate(e.createdAt)}</span>
              </td>
            </tr>`,
            )
            .join("")}
        </table>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>EarlyPost Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1e40af;padding:20px 24px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">📋 EarlyPost Digest</h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">${formatDate(new Date().toISOString())}</p>
            </td>
          </tr>

          <!-- Duty Person -->
          <tr>
            <td style="padding:20px 24px;background-color:#eff6ff;border-bottom:1px solid #dbeafe;">
              <p style="margin:0 0 4px;color:#1e40af;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Dienstheute</p>
              <p style="margin:0;color:#1e3a5f;font-size:16px;font-weight:600;">${escapeHtml(dutyName)}${dutyEmail ? ` <span style="font-weight:400;color:#3b82f6;font-size:14px;">(${escapeHtml(dutyEmail)})</span>` : ""}</p>
            </td>
          </tr>

          <!-- Open Tasks -->
          <tr>
            <td style="padding:20px 24px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:600;">📌 Offene Aufgaben (${data.tasks.length})</h2>
              ${tasksHtml}
            </td>
          </tr>

          <!-- Information Entries -->
          <tr>
            <td style="padding:20px 24px;border-top:1px solid #e5e7eb;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:600;">ℹ️ Informationen (${data.informationEntries.length})</h2>
              ${infoHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">EarlyPostTest — Automatischer Digest</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Escape HTML entities to prevent injection. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format an ISO date string as DD.MM.YYYY HH:mm. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}
