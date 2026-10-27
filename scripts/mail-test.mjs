// Sends one test email through Brevo with the settings in .env, to check
// that email works before anyone's notifications depend on it (mail.mjs):
//   docker exec analytics_node_app npm run mail-test -- you@example.com
// Says what Brevo answered, and what to fix when it refuses.

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const { mailConfig, sendEmail } = await import('../mail.mjs');
const { pool } = await import('../auth.mjs');

const to = String(process.argv[2] || '').trim().toLowerCase();
const cfg = mailConfig();
try {
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) throw new Error('Give the address to send the test to: npm run mail-test -- you@example.com');
  if (!cfg.key) throw new Error('There is no BREVO_API_KEY in .env, so email is off. Add it, then try again.');
  if (cfg.onlyTo.length && !cfg.onlyTo.includes(to)) throw new Error(`${to} isn't on MAIL_ONLY_TO in .env, which is set while email is being tried out.`);
  const result = await sendEmail({
    to,
    subject: 'OneTouch test email',
    text: `This is a test from OneTouch (${cfg.appUrl}). If you can read it, notification emails work.\n\nSent from ${cfg.from}.`,
    html: `<p>This is a test from <a href="${cfg.appUrl}">OneTouch</a>. If you can read it, notification emails work.</p><p style="color:#718096;font-size:12px">Sent from ${cfg.from}.</p>`,
  }, cfg);
  if (result.ok) {
    console.log(`Sent to ${to} from ${cfg.from} (Brevo message ${result.id || 'id not given'}). Check that inbox, and its junk folder.`);
  } else {
    console.error(`Brevo didn't send it: ${result.status ? `${result.status} ` : ''}${result.message}`);
    if (result.status === 401) console.error('  The API key is wrong, or Brevo blocked this computer\'s IP address: check your email from Brevo, or Security → Authorized IPs in Brevo.');
    if (result.status === 400 && /sender/i.test(result.message)) console.error(`  ${cfg.from} isn't a sender Brevo accepts yet: authenticate onetouch.fyi and add the sender in Brevo (Senders, Domains & Dedicated IPs).`);
    if (result.status === 403) console.error('  Brevo hasn\'t activated sending for this account yet; its support can.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
