// Problem reports, without a database: what's accepted, and that someone's
// words stay out of the email to admins.
//
//   npm test        (CI runs it on every push)

import assert from 'node:assert/strict';
import { CATEGORIES, cleanReport, IssueError, MAX_MESSAGE } from '../issues.mjs';
import { emailFor } from '../mail.mjs';

const refused = body => assert.throws(() => cleanReport(body), IssueError);

refused(null);
refused({ message: 'The charts will not load' });
refused({ category: 'nonsense', message: 'The charts will not load' });
refused({ category: 'constructor', message: 'The charts will not load' });
refused({ category: 'broken' });
refused({ category: 'broken', message: '  hi  ' });
refused({ category: 'broken', message: 'x'.repeat(MAX_MESSAGE + 1) });

const good = cleanReport({ category: 'broken', message: '  Charts\r\nwon\u0007t load  ', page: 'dashboard' });
assert.deepEqual(good, { category: 'broken', message: 'Charts\nwont load', page: 'Dashboards' });
assert.equal(cleanReport({ category: 'other', message: 'Something odd', page: '<script>' }).page, null, 'Only pages OneTouch has');

const SECRET_WORDS = 'INC1234567 is about the payroll outage';
const cfg = { appUrl: 'https://onetouch.test' };
const mail = emailFor({
  kind: 'issue', numbers: [], actor: 'Sam <b>Lee</b>', display_name: 'Ada Admin', username: 'aadmin',
  detail: { issue: 7, label: CATEGORIES.broken, page: 'Home', note: SECRET_WORDS },
}, cfg);
for (const part of [mail.subject, mail.text, mail.html]) {
  assert.ok(part.includes('reported a problem'), 'The email says what happened');
  assert.ok(!part.includes('payroll') && !part.includes('INC1234567'), 'Someone\'s words stay behind the sign-in');
}
assert.ok(mail.text.includes(CATEGORIES.broken), 'It says what kind of problem');
assert.ok(mail.html.includes('Sam &lt;b&gt;Lee&lt;/b&gt;') && !mail.html.includes('<b>Lee'), 'Names are escaped');

console.log('Problem reports: what is accepted, and what stays out of the email, are as they should be.');
process.exit(0);
