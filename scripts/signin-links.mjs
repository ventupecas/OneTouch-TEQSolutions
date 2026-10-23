// Prints a sign-in link for every account whose password you have, so each
// person can be handed their own: opening it fills in the sign-in form (see
// "Sign-in links" in README.md).
//
//   node scripts/signin-links.mjs <people.csv> [address]
//   node scripts/signin-links.mjs $HOME\Downloads\people.csv https://onetouch.fyi
//
// The CSV is the one the accounts were imported from (Username, Display Name,
// Password). The test accounts and warmup are added from .env
// (TESTER1_PASSWORD, TESTER2_PASSWORD, WARMUP_PASSWORD) when set. The address
// defaults to ONETOUCH_PUBLIC_URL from .env, else http://localhost:8000.
//
// The links hold passwords: the output goes to this terminal only. Don't save
// it in the project, commit it, or post it anywhere shared; send each person
// only their own line.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
dotenv.config({ quiet: true });

const [csvPath, addressArg] = process.argv.slice(2);
if (!csvPath) {
  console.error('Usage: node scripts/signin-links.mjs <people.csv> [address]');
  process.exit(1);
}
const address = (addressArg || process.env.ONETOUCH_PUBLIC_URL || `http://localhost:${process.env.APP_PORT || 8000}`).replace(/\/+$/, '');

// Username, Display Name, Password (the same columns `users.mjs import` reads)
const people = readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).filter(l => l.trim())
  .map(l => l.split(',').map(s => s.trim()))
  .map(([username, name, password]) => ({ username: username.toLowerCase(), name: name || username, password }))
  .filter(p => p.username && p.password)
  .sort((a, b) => a.name.localeCompare(b.name));

const fromEnv = [
  ['tester1', 'Test Account 1', process.env.TESTER1_PASSWORD],
  ['tester2', 'Test Account 2', process.env.TESTER2_PASSWORD],
  ['warmup', 'Warmup', process.env.WARMUP_PASSWORD],
].filter(([username, , password]) => password && !people.some(p => p.username === username))
  .map(([username, name, password]) => ({ username, name, password }));

const link = p => `${address}/#user=${encodeURIComponent(p.username)}&pass=${encodeURIComponent(p.password)}`;
for (const p of [...people, ...fromEnv]) {
  console.log(`${p.name} (username: ${p.username}, password: ${p.password}): ${link(p)}`);
}
console.error(`\n${people.length + fromEnv.length} links. Each one signs in as that person: send it to them only.`);
