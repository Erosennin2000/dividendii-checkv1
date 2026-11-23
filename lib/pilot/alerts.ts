import "server-only";
import type { Mailer } from "./mail";
import { fromHeader } from "./settings";
import type { PilotSettings } from "./settingsShared";

/**
 * Tells staff something needs a look: an email to the "copy me" address. Never throws, because an alert must not break the thing it reports on.
 * Returns whether an email was sent. With no address set it only writes to the log.
 */
export async function alertStaff(mailer: Mailer, settings: PilotSettings, subject: string, lines: string[]): Promise<boolean> {
  const to = settings.adminCopy || settings.replyTo;
  console.error("[pilot alert]", subject, lines.join(" | "));
  if (!to) return false;
  try {
    const text = lines.join("\n") + "\n\nOpen the staff page: https://www.dividendii.com/check/admin";
    const res = await mailer.send({ from: fromHeader(settings), to, subject: "[Dividendii alert] " + subject, text, html: `<div style="font-family:Arial,sans-serif;font-size:14px">${lines.map((l) => `<p>${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p>`).join("")}<p><a href="https://www.dividendii.com/check/admin">Open the staff page</a></p></div>` });
    return !(res.rejected ?? []).length;
  } catch (e) {
    console.error("[pilot alert] could not send the alert email", e);
    return false;
  }
}
