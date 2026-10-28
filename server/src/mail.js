import nodemailer from "nodemailer";
import { config } from "./config.js";

// Versand über das interne Mail-Relay (Postfix auf VM 106). Keine Zugangsdaten
// auf diesem Server; das Relay entscheidet, wohin weitergeleitet wird.

let transport = null;
function getTransport() {
  if (!config.mail) throw new Error("Mailversand ist nicht konfiguriert (SMTP_HOST fehlt)");
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: false, // STARTTLS, falls das Relay es anbietet
      tls: { rejectUnauthorized: config.mail.tlsVerify },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      // Keine Dateien oder URLs als Inhalt nachladen.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transport;
}

export const mailEnabled = () => !!config.mail;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Einfache Mail mit Text- und HTML-Teil. lines: Absätze; link optional als Knopf. */
function compose({ greeting, lines, link, linkLabel, footer }) {
  const text = [greeting, "", ...lines.flatMap((l) => [l, ""]), link ? `${linkLabel}:\n${link}\n` : "", footer || ""]
    .join("\n")
    .trim();
  const html = `<!doctype html><html lang="de"><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#2B2A28;background:#F3EFE4;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#FBF9F3;border:1px solid #E3DCC9;border-radius:16px;padding:24px">
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Next Step</p>
<p>${escapeHtml(greeting)}</p>
${lines.map((l) => `<p style="line-height:1.5">${escapeHtml(l)}</p>`).join("\n")}
${
  link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#B5723C;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;display:inline-block">${escapeHtml(linkLabel)}</a></p>
<p style="font-size:12px;color:#77705F;word-break:break-all">Falls der Knopf nicht funktioniert: ${escapeHtml(link)}</p>`
    : ""
}
${footer ? `<p style="font-size:12px;color:#77705F;margin-top:24px">${escapeHtml(footer)}</p>` : ""}
</div></body></html>`;
  return { text, html };
}

const FOOTER = "Diese Nachricht wurde automatisch verschickt. Wenn du nichts angefordert hast, kannst du sie ignorieren.";

export async function sendMail(to, subject, body) {
  await getTransport().sendMail({ from: config.mail.from, to, subject, ...compose({ footer: FOOTER, ...body }) });
}

export function verificationMail(name, link) {
  return {
    subject: "Bitte bestätige deine E-Mail-Adresse",
    body: {
      greeting: name ? `Hallo ${name},` : "Hallo,",
      lines: [
        "schön, dass du Next Step nutzen möchtest. Bitte bestätige noch deine E-Mail-Adresse, danach kannst du dich anmelden.",
        `Der Link gilt ${config.emailVerifyHours} Stunden.`,
      ],
      link,
      linkLabel: "E-Mail-Adresse bestätigen",
    },
  };
}

export function alreadyRegisteredMail(resetLink) {
  return {
    subject: "Du hast bereits ein Konto bei Next Step",
    body: {
      greeting: "Hallo,",
      lines: [
        "gerade wollte jemand mit dieser E-Mail-Adresse ein neues Konto anlegen. Es gibt aber bereits eines.",
        "Falls du das warst und dein Passwort nicht mehr weißt, kannst du hier ein neues festlegen. Der Link gilt 24 Stunden und nur einmal.",
      ],
      link: resetLink,
      linkLabel: "Neues Passwort festlegen",
    },
  };
}

export function resetMail(resetLink) {
  return {
    subject: "Neues Passwort für Next Step",
    body: {
      greeting: "Hallo,",
      lines: [
        "für dein Konto wurde ein neues Passwort angefordert. Über den Link legst du es fest. Er gilt 24 Stunden und nur einmal.",
      ],
      link: resetLink,
      linkLabel: "Neues Passwort festlegen",
    },
  };
}

export function ssoOnlyMail() {
  return {
    subject: "Anmeldung bei Next Step",
    body: {
      greeting: "Hallo,",
      lines: [
        "für dieses Konto wurde ein neues Passwort angefordert. Du meldest dich bei Next Step aber über dein ICF-Konto an und brauchst dafür kein eigenes Passwort.",
        "Nutze auf der Anmeldeseite den Knopf „Mit ICF-Konto anmelden“.",
      ],
    },
  };
}

export function breakGlassMail(who, ip, until) {
  return {
    subject: "Next Step: Verwaltung per Break-Glass freigeschaltet",
    body: {
      greeting: "Hallo,",
      lines: [
        `${who} hat soeben mit einem lokalen Admin-Konto die Verwaltung von Next Step freigeschaltet (IP ${ip}).`,
        `Die Freischaltung gilt bis ${until}.`,
        "Falls das nicht geplant war, bitte sofort prüfen.",
      ],
    },
  };
}
