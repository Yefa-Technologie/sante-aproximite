import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporterPromise = null;

async function getTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    const error = new Error("Configuration SMTP absente");
    error.status = 503;
    throw error;
  }

  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: env.smtpHost,
        port: Number(env.smtpPort || 587),
        secure: String(env.smtpSecure || "false").toLowerCase() === "true",
        requireTLS: env.smtpRequireTLS,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass,
        },
      })
    );
  }

  return transporterPromise;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatLines(lines) {
  return lines
    .filter((line) => line && String(line).trim())
    .map((line) => `<p style="margin:0 0 10px;">${escapeHtml(line)}</p>`)
    .join("");
}

export async function sendMailToYefa({ subject, lines, metadata = {} }) {
  const transporter = await getTransporter();
  const fromAddress = env.mailFrom || env.smtpUser;
  const toAddress = env.contactRecipient || "yefa.technologie@gmail.com";
  const metaRows = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(
      ([key, value]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:700;">${escapeHtml(
          key
        )}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#0098cd,#1a6db5);color:#ffffff;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.82;">Sante Aproximite</p>
          <h1 style="margin:0;font-size:22px;line-height:1.2;">${escapeHtml(subject)}</h1>
        </div>
        <div style="padding:22px 24px;color:#0f172a;">
          ${formatLines(lines)}
          ${
            metaRows
              ? `<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">${metaRows}</table>`
              : ""
          }
        </div>
      </div>
    </div>
  `;

  const text = [
    subject,
    "",
    ...lines.map((line) => String(line || "").trim()).filter(Boolean),
    "",
    ...Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(([key, value]) => `${key}: ${value}`),
  ].join("\n");

  await transporter.sendMail({
    from: fromAddress,
    to: toAddress,
    subject,
    text,
    html,
    replyTo: metadata.email || undefined,
  });
}
