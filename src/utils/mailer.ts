import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';

import { env, isMailConfigured, publicBaseUrl } from '../config/env';
import { ApiError } from './ApiError';
import { EMAIL_LOGO_PATH, LOGO_CID } from './emailLayout';
import { logger } from './logger';

/** Fail fast: a blocked SMTP port otherwise hangs until the app's request times out. */
const MAIL_TIMEOUT_MS = 10_000;
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

let transporter: Transporter | undefined;

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: SendMailOptions['attachments'];
}

/** "Nexity <hello@example.com>" → { name, email }. */
function parseSender(from: string) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1] || undefined, email: match[2]! } : { email: from.trim() };
}

async function sendViaBrevo(message: MailMessage) {
  let html = message.html;
  const files: { name: string; content: string }[] = [];
  for (const a of message.attachments ?? []) {
    if (a.cid === LOGO_CID) {
      // Brevo can't embed inline images, so point at the copy this API serves.
      if (publicBaseUrl) {
        html = html.replaceAll(`cid:${LOGO_CID}`, `${publicBaseUrl}${EMAIL_LOGO_PATH}`);
      }
    } else if (Buffer.isBuffer(a.content)) {
      files.push({ name: a.filename || 'attachment', content: a.content.toString('base64') });
    }
  }

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY!,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseSender(env.MAIL_FROM),
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: html,
      textContent: message.text,
      ...(files.length ? { attachment: files } : {}),
    }),
    signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
  }
}

export async function sendMail(message: MailMessage) {
  if (!isMailConfigured) {
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      'Email (SMTP not configured)',
    );
    return;
  }
  try {
    if (env.BREVO_API_KEY) {
      await sendViaBrevo(message);
    } else {
      await getTransporter().sendMail({ from: env.MAIL_FROM, ...message });
    }
  } catch (err) {
    logger.error({ err, to: message.to }, 'Failed to send email');
    throw new ApiError(
      503,
      'We couldn’t send the email right now. Please try again.',
      undefined,
      'EMAIL_SEND_FAILED',
    );
  }
}
