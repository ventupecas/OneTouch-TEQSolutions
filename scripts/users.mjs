// Manage OneTouch sign-in accounts.
//
// Run inside the app container (it can reach the database):
//   docker exec -it analytics_node_app npm run users -- list
//   docker exec -it analytics_node_app npm run users -- add jsmith "Jane Smith"
//   docker exec -it analytics_node_app npm run users -- reset-password jsmith
//   docker exec -it analytics_node_app npm run users -- deactivate jsmith
//   docker exec -it analytics_node_app npm run users -- activate jsmith
//
// Many at once, from a CSV with a header row: Username, Display Name, Password
// (Display Name is optional). The file is piped in, so it never has to be
// copied into the project folder. From PowerShell:
//   Get-Content $HOME\Downloads\people.csv | docker exec -i analytics_node_app node scripts/users.mjs import -
// Existing usernames are skipped, never overwritten.
//
// Passwords are typed at a hidden prompt. For automation, pipe the password
// in and add --password-stdin (e.g. echo "secret" | ... add jsmith --password-stdin).

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const auth = await import('../auth.mjs');

const USAGE = `Usage: npm run users -- <command> [args]

  list                              Show every account
  add <username> ["Display Name"]   Create an account (asks for a password)
  reset-password <username>         Set a new password (signs them out everywhere)
  deactivate <username>             Block sign-in (signs them out everywhere)
  activate <username>               Allow sign-in again
  import <file.csv | ->             Add everyone in a CSV (columns: Username, Display Name, Password);
                                    "-" reads the CSV from stdin. Existing usernames are skipped.

Add --password-stdin to read the password from stdin instead of prompting.`;

// Reads a line from the terminal without echoing what is typed
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No terminal to type a password into. Run with "docker exec -it", or use --password-stdin.'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

async function askNewPassword(fromStdin) {
  if (fromStdin) return readStdin();
  const first = await promptHidden('New password: ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('The two passwords did not match.');
  return first;
}

// Splits CSV text into rows of fields; handles quoted fields with commas,
// doubled quotes and line breaks inside quotes
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

async function importCsv(source) {
  const fs = await import('node:fs/promises');
  const text = (source === '-' ? await readStdin() : await fs.readFile(source, 'utf8')).replace(/^﻿/, '');
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The CSV is empty.');

  // Columns are found by name, in any order and any capitalization
  const col = name => header.findIndex(h => h.trim().toLowerCase().replace(/[\s_-]+/g, '') === name);
  const iUser = col('username'), iName = col('displayname'), iPass = col('password');
  if (iUser < 0 || iPass < 0) {
    throw new Error(`The header row needs "Username" and "Password" columns (found: ${header.join(', ')}).`);
  }

  const added = [], skipped = [], failed = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 2; // +1 for the header, +1 for counting from 1
    const username = (row[iUser] || '').trim();
    const password = row[iPass] ?? '';
    const displayName = iName >= 0 ? (row[iName] || '').trim() || null : null;
    const key = auth.normalizeUsername(username);

    if (!username) { failed.push(`line ${line}: no username`); continue; }
    if (seen.has(key)) { failed.push(`line ${line}: ${key} appears more than once in the file`); continue; }
    seen.add(key);

    try {
      await auth.addUser(username, password, displayName);
      added.push(key);
    } catch (err) {
      if (/already exists/.test(err.message)) skipped.push(key);
      else failed.push(`line ${line} (${key}): ${err.message}`);
    }
  }

  console.log(`Added ${added.length} of ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.`);
  if (added.length) console.log(`  Added: ${added.join(', ')}`);
  if (skipped.length) console.log(`  Skipped (already have an account, password left unchanged): ${skipped.join(', ')}`);
  if (failed.length) {
    console.log('  Not added:');
    for (const f of failed) console.log(`    ${f}`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--password-stdin');
  const [command, username, displayName] = args.filter(a => a !== '--password-stdin');

  await auth.ensureSchema();

  switch (command) {
    case 'list': {
      const users = await auth.listUsers();
      if (!users.length) return console.log('No accounts yet. Add one with: npm run users -- add <username>');
      console.table(users.map(u => ({
        username: u.username,
        name: u.display_name || '',
        status: !u.is_active ? 'deactivated' : u.locked ? 'locked (too many tries)' : 'active',
        created: u.created_at.toISOString().slice(0, 10),
        'last sign-in': u.last_login_at ? u.last_login_at.toISOString().replace('T', ' ').slice(0, 16) : 'never',
      })));
      return;
    }
    case 'add': {
      if (!username) throw new Error('Give a username: add <username> ["Display Name"]');
      const name = await auth.addUser(username, await askNewPassword(fromStdin), displayName || null);
      return console.log(`Added ${name}. They sign in as ${name} (or ${name}@molsoncoors.com).`);
    }
    case 'reset-password': {
      if (!username) throw new Error('Give a username: reset-password <username>');
      const name = await auth.resetPassword(username, await askNewPassword(fromStdin));
      return console.log(`Password changed for ${name}. Any open sessions were signed out.`);
    }
    case 'deactivate':
    case 'activate': {
      if (!username) throw new Error(`Give a username: ${command} <username>`);
      const name = await auth.setActive(username, command === 'activate');
      return console.log(command === 'activate' ? `${name} can sign in again.` : `${name} can no longer sign in and was signed out.`);
    }
    case 'import': {
      if (!username) throw new Error('Give a CSV file, or "-" to read it from stdin: import <file.csv | ->');
      return importCsv(username);
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await auth.pool.end();
}
