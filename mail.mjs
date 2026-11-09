// =====================================================================
// EMAIL: every 🔔 notification (notifications.mjs) also goes out by email,
// through Brevo's transactional email API, to people with an address on
// file (users.email) who haven't turned it off in the 🔔 panel:
//
//   assigned   someone gave you tickets
//   family     a family was moved to the team you're the project manager of
//   report     someone on your team says they resolved or closed a ticket
//   issue      someone reported a problem with OneTouch (to admins; issues.mjs)
//
// An outbox: notify() saves each notification in the same transaction as
// the change it reports, as 'pending', and every MAIL_INTERVAL this sends the
// pending ones. So an email only ever goes out for a change that was saved,
// and a failed send never undoes the change: it's tried again, waiting longer
// each time, up to MAX_TRIES times. One notification is one email, however
// many tickets it's about.
//
// Never emailed (marked 'skipped', with why): test and service accounts,
// deactivated accounts, anyone with no address or who turned it off, anyone
// not on MAIL_ONLY_TO when that's set (for trying it out), and a notification
// more than MAX_AGE old when its turn comes, so a server that was off, or
// email switched on later, doesn't send a pile of old news. An email says who
// did what and which tickets, with a link to OneTouch; ticket summaries and a
// member's note stay behind the sign-in.
//
// Settings, in .env (read at start):
//   BREVO_API_KEY   Brevo → SMTP & API → API keys. None: email is off.
//   MAIL_FROM       the sender, on a domain authenticated in Brevo (notifications@onetouch.fyi)
//   MAIL_FROM_NAME  the name it shows (OneTouch)
//   APP_URL         where the emails link to (https://onetouch.fyi)
//   MAIL_ONLY_TO    comma-separated addresses: while it's set, nobody else is emailed,
//                   unless a permanent admin switches on "Email everyone" (Team tab, demo day)
// For tests only: BREVO_API_URL (a stand-in for Brevo), MAIL_INTERVAL_MS, MAIL_RETRY_MS.
// =====================================================================

import { pool } from './auth.mjs';
import { isTestOrServiceAccount, emailsEveryone } from './teams.mjs';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BATCH = 20;                  // emails per round, well inside Brevo's limits
const MAX_TRIES = 5;
const MAX_AGE_MS = 60 * 60 * 1000; // older than this when its turn comes: not sent
const SHOWN_NUMBERS = 20;          // tickets listed in an email before "and N more"
const SEND_TIMEOUT_MS = 15000;

export function mailConfig(env = process.env) {
  return {
    key: env.BREVO_API_KEY || '',
    url: env.BREVO_API_URL || BREVO_URL,
    from: env.MAIL_FROM || 'notifications@onetouch.fyi',
    fromName: env.MAIL_FROM_NAME || 'OneTouch',
    appUrl: (env.APP_URL || 'https://onetouch.fyi').replace(/\/+$/, ''),
    onlyTo: String(env.MAIL_ONLY_TO || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
    intervalMs: Number(env.MAIL_INTERVAL_MS) || 30 * 1000,
    retryMs: Number(env.MAIL_RETRY_MS) || 60 * 1000,
  };
}

// Is email set up on this server? (the 🔔 panel says so when it isn't)
export const mailEnabled = () => Boolean(mailConfig().key);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One notification as an email, worded as the 🔔 panel words it (public/notifications.js).
// n: { kind, numbers, detail, actor, display_name, username } -> { subject, text, html }
export function emailFor(n, cfg = mailConfig()) {
  const d = n.detail || {};
  const who = n.actor || 'Someone';
  const count = d.count || n.numbers.length;
  const many = number => number.toLocaleString('en-US');
  let what, where;
  if (n.kind === 'assigned') {
    const on = d.team ? ` on ${d.team}` : '';
    what = d.family && d.size > 1
      ? `${who} gave you a family of ${many(d.size)} linked tickets${on}`
      : `${who} gave you ${count === 1 ? n.numbers[0] : `${many(count)} tickets`}${on}`;
    where = 'They\'re in Assigned to me on your OneTouch Home page.';
  } else if (n.kind === 'family') {
    what = d.source === 'servicenow'
      ? `A new link from ServiceNow brought ${count === 1 ? n.numbers[0] : `${many(count)} linked tickets`} into a family on ${d.team}`
      : count === 1 ? `${who} moved ${n.numbers[0]} to ${d.team}` : `${who} moved a family of ${many(count)} linked tickets to ${d.team}`;
    where = `${count === 1 ? 'It isn\'t' : 'They aren\'t'} assigned to anyone yet: hand ${count === 1 ? 'it' : 'them'} out on the Team tab.`;
  } else if (n.kind === 'report') {
    what = `${who} says they ${d.status} ${n.numbers[0]}`;
    where = `${d.note ? 'They left you a note. ' : ''}See it on the Team tab, under the ticket's state. The ticket itself doesn't change in OneTouch.`;
  } else if (n.kind === 'issue') {
    // The kind of problem only: what they wrote stays behind the sign-in
    what = `${who} reported a problem with OneTouch: ${d.label}`;
    where = 'Read it and mark it resolved in OneTouch, on the Architecture page, under Reports.';
  } else {
    what = `${who} sent you a notification`;
    where = 'See it under the 🔔 in OneTouch.';
  }
  const shown = count > 1 ? n.numbers.slice(0, SHOWN_NUMBERS) : [];
  const more = shown.length ? count - shown.length : 0;
  const tickets = shown.length ? `Tickets: ${shown.join(', ')}${more > 0 ? `, and ${many(more)} more` : ''}` : '';
  const first = String(n.display_name || n.username || '').trim().split(/\s+/)[0] || 'there';
  const footer = 'You get these emails because email is on for your OneTouch notifications. ' +
    'To stop them, open the 🔔 in OneTouch and untick "Email me these too".';
  const text = [`Hi ${first},`, '', `${what}.`, ...(tickets ? ['', tickets] : []), '', where, '', `Open OneTouch: ${cfg.appUrl}`, '', '--', footer].join('\n');
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#2d3748;max-width:560px">' +
    `<p>Hi ${escapeHtml(first)},</p>` +
    `<p style="font-size:16px"><strong>${escapeHtml(what)}.</strong></p>` +
    (tickets ? `<p style="color:#4a5568">${escapeHtml(tickets)}</p>` : '') +
    `<p>${escapeHtml(where)}</p>` +
    `<p><a href="${escapeHtml(cfg.appUrl)}" style="display:inline-block;background:#10a37f;color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">Open OneTouch</a></p>` +
    `<p style="font-size:12px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px;margin-top:20px">${escapeHtml(footer)}</p></div>`;
  return { subject: what, text, html };
}

// Why a notification isn't emailed, or '' if it is.
// n: { username, email, email_notifications, is_active, created_at }
export function skipReason(n, cfg = mailConfig(), now = Date.now()) {
  if (isTestOrServiceAccount(n.username)) return 'a test or service account';
  if (!n.is_active) return 'the account is deactivated';
  if (!n.email) return 'no email address on file';
  if (!n.email_notifications) return 'they turned email off';
  // The Team tab's "Email everyone" (demo day) lifts MAIL_ONLY_TO while it's on
  if (cfg.onlyTo.length && !emailsEveryone() && !cfg.onlyTo.includes(String(n.email).toLowerCase())) return 'not on MAIL_ONLY_TO';
  if (now - new Date(n.created_at).getTime() > MAX_AGE_MS) return 'too old by the time it could be sent';
  return '';
}

// One email through Brevo -> { ok, id } or { ok: false, status, message }
export async function sendEmail({ to, name, subject, text, html }, cfg = mailConfig()) {
  try {
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: cfg.fromName, email: cfg.from },
        to: [{ email: to, ...(name ? { name } : {}) }],
        subject, textContent: text, htmlContent: html,
        tags: ['onetouch-notification'],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, id: body.messageId || null };
    return { ok: false, status: response.status, message: String(body.message || body.code || response.statusText).slice(0, 300) };
  } catch (error) {
    return { ok: false, status: 0, message: `Could not reach Brevo: ${error.message}`.slice(0, 300) };
  }
}

// One round: every pending notification whose turn it is, oldest first
let sending = false;
export async function sendPending(cfg = mailConfig()) {
  if (sending || !cfg.key) return { sent: 0, skipped: 0, failed: 0 };
  sending = true;
  const tally = { sent: 0, skipped: 0, failed: 0 };
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.kind, n.numbers, n.detail, n.created_at, n.email_tries,
              u.username, u.display_name, u.email, u.email_notifications, u.is_active,
              coalesce(a.display_name, a.username) AS actor
         FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN users a ON a.id = n.actor_id
        WHERE n.email_state = 'pending' AND (n.email_next_at IS NULL OR n.email_next_at <= now())
        ORDER BY n.id LIMIT ${BATCH}`);
    for (const n of rows) {
      const why = skipReason(n, cfg);
      if (why) {
        await pool.query("UPDATE notifications SET email_state = 'skipped', email_note = $2 WHERE id = $1", [n.id, why]);
        tally.skipped += 1;
        continue;
      }
      const mail = emailFor(n, cfg);
      const result = await sendEmail({ to: n.email, name: n.display_name || n.username, ...mail }, cfg);
      const tries = n.email_tries + 1;
      if (result.ok) {
        await pool.query("UPDATE notifications SET email_state = 'sent', email_tries = $2, emailed_at = now(), email_note = $3 WHERE id = $1",
          [n.id, tries, result.id]);
        console.log(`✉️  Emailed ${n.username}: ${n.kind} (notification ${n.id})`);
        tally.sent += 1;
      } else {
        const note = `${result.status ? `Brevo answered ${result.status}: ` : ''}${result.message}`;
        // Waits 1, 2, 4, 8 minutes between tries, then gives up
        await pool.query(
          `UPDATE notifications SET email_tries = $2, email_note = $3,
                  email_state = CASE WHEN $2 >= ${MAX_TRIES} THEN 'failed' ELSE 'pending' END,
                  email_next_at = now() + make_interval(secs => $4)
            WHERE id = $1`,
          [n.id, tries, note, (cfg.retryMs * 2 ** (tries - 1)) / 1000]);
        console.error(`✉️  Could not email ${n.username} (notification ${n.id}, try ${tries} of ${MAX_TRIES}): ${note}`);
        tally.failed += 1;
      }
    }
  } finally {
    sending = false;
  }
  return tally;
}

// Starts the rounds (once the notifications table is ready). No key: email is off.
let timer = null;
export function startMail() {
  const cfg = mailConfig();
  if (!cfg.key) {
    console.log('✉️  Email is off (no BREVO_API_KEY in .env); notifications only show under the 🔔');
    return;
  }
  console.log(`✉️  Email is on: from ${cfg.from}${cfg.onlyTo.length
    ? `, only to ${cfg.onlyTo.length} ${cfg.onlyTo.length === 1 ? 'address' : 'addresses'} (MAIL_ONLY_TO)` : ', to everyone with an address'}`);
  const round = () => sendPending(cfg).catch(error => console.error('✉️  Sending emails failed:', error.message));
  clearInterval(timer);
  timer = setInterval(round, cfg.intervalMs);
  round();
}
