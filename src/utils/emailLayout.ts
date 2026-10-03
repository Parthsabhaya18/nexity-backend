import { NEXITY_LOGO_PNG_BASE64 } from './emailLogo';

const LOGO_CID = 'nexity-logo';

/** Calm palette from THEMING.md; fixed so emails look the same in every client. */
const c = {
  page: '#EFF8FF',
  surface: '#FFFFFF',
  primary: '#3B82F6',
  button: '#1D4ED8',
  text: '#0F2747',
  muted: '#58708C',
  border: '#CFE5FA',
  sky: '#38BDF8',
};

const font = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

export interface CodeEmailOptions {
  /** Inbox preview line. */
  preheader: string;
  title: string;
  greetingName: string;
  intro: string;
  code: string;
  expiresInMinutes: number;
  /** Shown under the code, e.g. why the user got this email. */
  footnote: string;
}

/** Branded one-time-code email. Values are escaped here. */
export function renderCodeEmail(o: CodeEmailOptions) {
  const year = new Date().getFullYear();
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(o.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${c.page};font-family:${font};color:${c.text};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.page}">
<tr><td align="center" style="padding:40px 16px">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td align="center" style="padding:0 0 24px">
<img src="cid:${LOGO_CID}" width="160" height="42" alt="Nexity" style="display:block;border:0;outline:none;text-decoration:none;width:160px;height:42px">
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:${c.surface};border:1px solid ${c.border};border-radius:20px;overflow:hidden">
<tr><td height="6" style="height:6px;line-height:6px;font-size:0;background-color:${c.primary};background-image:linear-gradient(90deg,${c.sky},${c.primary},${c.button})">&nbsp;</td></tr>
<tr><td style="padding:36px 36px 32px">
<h1 style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:700;color:${c.text}">${escapeHtml(o.title)}</h1>
<p style="margin:0 0 8px;font-size:16px;line-height:24px;color:${c.text}">Hi ${escapeHtml(o.greetingName)},</p>
<p style="margin:0 0 28px;font-size:15px;line-height:23px;color:${c.muted}">${escapeHtml(o.intro)}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:24px 16px;background-color:${c.page};border:1px dashed ${c.primary};border-radius:14px">
<p style="margin:0 0 10px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${c.muted}">Your code</p>
<p style="margin:0;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:36px;line-height:44px;font-weight:700;letter-spacing:12px;padding-left:12px;color:${c.button}">${escapeHtml(o.code)}</p>
</td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 0">
<tr><td style="padding:6px 14px;background-color:${c.page};border:1px solid ${c.border};border-radius:999px;font-size:13px;line-height:18px;color:${c.button};font-weight:600">
&#9201;&nbsp; Expires in ${o.expiresInMinutes} minutes
</td></tr>
</table>

<p style="margin:28px 0 0;padding:16px 0 0;border-top:1px solid ${c.border};font-size:13px;line-height:20px;color:${c.muted}">${escapeHtml(o.footnote)}</p>
<p style="margin:12px 0 0;font-size:13px;line-height:20px;color:${c.muted}"><strong style="color:${c.text}">Keep it private.</strong> Nexity will never ask you for this code by phone, chat, or DM.</p>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td align="center" style="padding:24px 16px 0;font-size:12px;line-height:18px;color:${c.muted}">
This is an automated message from Nexity. Please don’t reply.<br>
&copy; ${year} Nexity. All rights reserved.
</td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;

  return { html, attachments: [logoAttachment()] };
}

function logoAttachment() {
  return {
    filename: 'nexity-logo.png',
    content: Buffer.from(NEXITY_LOGO_PNG_BASE64, 'base64'),
    contentType: 'image/png',
    cid: LOGO_CID,
    contentDisposition: 'inline' as const,
  };
}
