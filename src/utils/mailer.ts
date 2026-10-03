import nodemailer, { type Transporter } from 'nodemailer';

import { env, isMailConfigured } from '../config/env';
import { ApiError } from './ApiError';
import { logger } from './logger';

let transporter: Transporter | undefined;

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
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
    await getTransporter().sendMail({ from: env.MAIL_FROM, ...message });
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
