import { User } from '../users/user.model.js';
import { sendEmail } from './email.service.js';
import { riderUrl, driverUrl } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * One look for every FoloRide email. { heading, lines: [paragraphs], rows: [[label, value]], button: {label, url} }
 * Returns the plain-text and HTML versions (sent together so every mail app shows something readable).
 */
export function renderEmail({ heading, lines = [], rows = [], button }) {
  const text = [heading, '', ...lines, ...(rows.length ? ['', ...rows.map(([k, v]) => `${k}: ${v}`)] : []), ...(button ? ['', `${button.label}: ${button.url}`] : []), '', 'FoloRide'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#10211a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="padding:18px 24px;background:#0b7a4b;color:#ffffff;font-size:22px;font-weight:bold">Folo<span style="color:#10211a">Ride</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5;font-size:15px">${esc(l)}</p>`).join('')}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid #e3e8e5">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e3e8e5;color:#5b6b63;font-size:14px">${esc(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #e3e8e5;font-size:14px;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>` : ''}
${button ? `<p style="margin:16px 0 0"><a href="${esc(button.url)}" style="background:#0b7a4b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;background:#f4f6f5;color:#8a978f;font-size:12px">You are getting this because you use FoloRide. Please do not reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Sends a branded email to a user if they have an email on their account. Never throws and never blocks the caller. */
export async function emailUser(userId, { subject, _to, ...content }) {
  try {
    const user = await User.findById(userId).select('email role notificationPrefs');
    const to = _to || user?.email; // _to: send to a specific address (e.g. the old email after a change)
    if (!to) return false;
    if (user.notificationPrefs?.email === false) return false;
    const { text, html } = renderEmail({ button: undefined, ...content });
    return await sendEmail(to, subject, text, html);
  } catch (err) {
    logger.error({ err }, 'emailUser failed');
    return false;
  }
}

export const appLink = (role) => (role === 'driver' ? driverUrl : riderUrl);
