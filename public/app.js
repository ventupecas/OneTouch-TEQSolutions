// =====================================================================
// SIGN IN: the server checks the credentials and hands back a session
// token, which every API call then sends as "Authorization: Bearer ..."
// =====================================================================

const API_BASE = 'http://localhost:8000';
const TOKEN_KEY = 'onetouch-session';

// sessionStorage can be blocked (private windows, strict settings)
function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(token) {
    try {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* stays signed in until the page is reloaded */ }
}

let sessionTokenValue = readToken();

function authHeaders() {
    return sessionTokenValue ? { Authorization: `Bearer ${sessionTokenValue}` } : {};
}

function showLoginError(message) {
    document.getElementById('login-error').textContent = message || '';
}

function showApp(signedIn) {
    document.body.classList.toggle('signed-out', !signedIn);
    if (signedIn) document.getElementById('user-prompt').focus();
    else document.getElementById('login-email').focus();
}

// The signed-in person's name, shown in the header and the chat greeting
// (their display name, or their username if they don't have one)
let currentUserName = '';

function setCurrentUser(user) {
    currentUserName = user ? (user.displayName || user.username || '') : '';
    document.getElementById('user-name').textContent = currentUserName;
    // The greeting uses just the first name: "Cassidy Sotelo" -> "Hello, Cassidy!"
    const firstName = currentUserName.trim().split(/\s+/)[0];
    const welcome = document.getElementById('welcome-msg');
    if (welcome) welcome.textContent = firstName ? `Hello, ${firstName}!` : 'Hello!';
}

// Who owns the stored session (after a reload, the name isn't known yet)
async function loadCurrentUser() {
    if (!sessionTokenValue) return;
    try {
        const response = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        if (response.ok) setCurrentUser(await response.json());
    } catch (err) {
        console.error('Could not load the signed-in user:', err);
    }
}

async function signIn() {
    const button = document.getElementById('login-btn');
    const passwordField = document.getElementById('login-password');
    showLoginError('');
    button.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('login-email').value,
                password: passwordField.value,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) {
            showLoginError(data.error || 'Sign-in failed. Please try again.');
            passwordField.value = '';
            passwordField.focus();
            return;
        }
        sessionTokenValue = data.token;
        saveToken(data.token);
        passwordField.value = '';
        clearChat();
        setCurrentUser(data);
        showApp(true);
    } catch (err) {
        showLoginError('Could not reach the OneTouch server. Please try again.');
        console.error(err);
    } finally {
        button.disabled = false;
    }
}

function signOut(message) {
    if (sessionTokenValue) {
        fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: authHeaders() }).catch(() => {});
    }
    sessionTokenValue = null;
    saveToken(null);
    // The next person to sign in on this computer must not see this person's chat
    clearChat();
    setCurrentUser(null);
    showLoginError(typeof message === 'string' ? message : '');
    showApp(false);
}

// An expired session (or a server restart) sends the user back to sign in
function handleUnauthorized(response) {
    if (response.status !== 401) return false;
    signOut('Your session has ended. Please sign in again.');
    return true;
}

// =====================================================================
// CONVERSATION MEMORY: the server keeps this session's questions and
// Claude's answers, so follow-ups ("same but for changes") work.
// "New chat" clears both the screen and Claude's memory.
// =====================================================================

const WELCOME_HTML = document.getElementById('chat-log').innerHTML;

// Back to just the greeting (with the signed-in person's name)
function clearChat() {
    document.getElementById('chat-log').innerHTML = WELCOME_HTML;
    exportPayloads.clear();
    setCurrentUser(currentUserName ? { displayName: currentUserName } : null);
}

async function resetConversation() {
    if (!sessionTokenValue) return;
    try {
        const response = await fetch(`${API_BASE}/api/conversation/reset`, { method: 'POST', headers: authHeaders() });
        handleUnauthorized(response);
    } catch (err) {
        console.error('Could not reset the conversation:', err);
    }
}

async function newChat() {
    await resetConversation();
    clearChat();
    document.getElementById('user-prompt').focus();
}

// A token from earlier in this tab skips the sign-in page; if it has
// expired, the first API call returns 401 and brings the page back
showApp(Boolean(sessionTokenValue));
loadCurrentUser();

// A reload empties the chat on screen, so Claude forgets it too
resetConversation();

// Tab Views Toggling Module
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`${viewName}-view`).classList.add('active');
}

// Asynchronous Chat Workflow Engine
async function sendPrompt() {
    const inputField = document.getElementById('user-prompt');
    const chatLog = document.getElementById('chat-log');
    const userPromptText = inputField.value.trim();
    console.log("User Prompt Text:", userPromptText);

    if (!userPromptText) return;

    // Append User message node to DOM bubble UI
    appendMessage('user-msg', userPromptText);
    inputField.value = '';

    // Append standard generic loading sequence notification
    const loadingId = appendMessage('ai-msg', '🤖 Thinking and querying Cube.dev...');

               try {
        // 🎯 FIX: Explicitly relative route path
        const response = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        console.log("THIS IS THE RESPONSE FROM THE SERVER:", response.status, response.statusText);

        if (handleUnauthorized(response)) {
            document.getElementById(loadingId).remove();
            return;
        }

        const data = await response.json();


        document.getElementById(loadingId).remove(); // Clear loading block

        if (data.memoryReset) {
            appendMessage('system-msg', 'This conversation got long, so Claude started fresh. Earlier questions are no longer remembered.');
        }

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${data.error}`);
            return;
        }

        // Clarification or unsupported question: show the explanation only
        if (data.intent === 'clarify' || data.intent === 'unsupported') {
            appendMessage('ai-msg', `🙋 ${escapeHtml(data.message || 'I need a little more detail to run that.')}`);
            return;
        }

        // Normal query: restate what was fetched, show the rows as a table,
        // and tuck the assumptions into a collapsible note underneath
        let html = `<div class="result-title">${escapeHtml(data.message || 'Here is what I found:')}</div>`;
        if (data.combined) {
            // Counts across several ticket types: one table, one column per type
            html += renderCombined(data.combined);
        } else if (data.sections && data.sections.length > 1) {
            // Lists across several ticket types: one titled table per type
            html += data.sections.map(s =>
                `<div class="section-title">${escapeHtml(capitalize(nounFor(s.entity, 2)))}</div>` +
                renderResults(s.rows, s.entity)
            ).join('');
        } else {
            html += renderResults(data.results || [], data.entity);
        }

        if (data.assumptions && data.assumptions.length > 0) {
            html += `<details class="assumptions"><summary>How I read your question</summary><ul>` +
                data.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('') +
                `</ul></details>`;
        }

        // Offer the same tables as a download in any of the export formats
        const tables = buildExportTables(data);
        if (tables.length) {
            html += downloadBarHtml(registerExport({
                title: data.message || 'One Touch results',
                question: userPromptText,
                tables,
            }));
        }

        appendMessage('ai-msg wide', html);

    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMessage('ai-msg', `❌ Could not talk to backend server orchestration framework.`);
        console.error(err);
    }
}

// Escape text that came from the server or the model before inserting as HTML
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =====================================================================
// RESULT RENDERING: rows from Cube -> readable table in plain English
// =====================================================================

// What one row of each table is called, for count headers and summaries
const ENTITY_NOUNS = {
    incident: ['incident', 'incidents'],
    change_request: ['change', 'changes'],
    change_approvals: ['change approval', 'change approvals'],
    sc_req_item: ['request', 'requests'],
    ritm_approvals: ['request approval', 'request approvals'],
    sc_task: ['task', 'tasks'],
};

// Column names that read badly when simply title-cased
const COLUMN_LABELS = {
    number: 'Ticket',
    short_description: 'Summary',
    description: 'Full Description',
    assignment_group: 'Assigned Team',
    owner_group: 'Owning Team',
    assigned_to: 'Assigned To',
    opened_by_group: 'Opened By Team',
    configuration_item: 'Server / System',
    contact_type: 'Reported Via',
    reassignment_count: 'Times Reassigned',
    reopen_count: 'Times Reopened',
    caused_by_change: 'Caused By Change',
    was_p1: 'Was Ever P1',
    on_hold_reason: 'On Hold Because',
    close_code: 'Close Result',
    close_notes: 'Close Notes',
    cause_code: 'Cause',
    sub_type: 'Change Category',
    type: 'Change Type',
    planned_start_date: 'Planned Start',
    planned_end_date: 'Planned End',
    planned_start_month: 'Planned Start Month',
    outage: 'Planned Outage',
    sap_impact: 'Affects SAP',
    sap_transport_required: 'SAP Transport Needed',
    process_failure: 'Process Failure',
    brewery: 'Brewery Change',
    brewery_locations: 'Breweries Affected',
    item: 'Catalog Item',
    requested_for: 'Requested For',
    opened_by: 'Opened By',
    request: 'Parent Order (REQ)',
    request_item: 'Parent Request (RITM)',
    parent: 'Parent Ticket',
    sla_flag: 'SLA Breached',
    active: 'Still Active',
    fulfilled_time: 'Fulfilled',
    kb_article: 'Knowledge Article',
    created_day: 'Day Created',
    created_week: 'Week Created',
    created_month: 'Month Created',
    opened_day: 'Day Opened',
    opened_week: 'Week Opened',
    opened_month: 'Month Opened',
    resolved_day: 'Day Resolved',
    resolved_month: 'Month Resolved',
    closed_day: 'Day Closed',
    closed_month: 'Month Closed',
};

// Columns whose values are long free text: shortened in tables, full on hover
const LONG_TEXT = new Set(['short_description', 'description', 'close_notes', 'work_notes',
    'comments_and_work_notes', 'additional_comments', 'change_plan', 'backout_plan',
    'verification_plan', 'purpose_of_change', 'approval_history']);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

function splitMember(member) {
    const dot = member.indexOf('.');
    return { cube: member.slice(0, dot), column: member.slice(dot + 1) };
}

function columnLabel(member) {
    const { cube, column } = splitMember(member);
    if (column === 'count') {
        const noun = (ENTITY_NOUNS[cube] || ['record', 'records'])[1];
        return `Number of ${noun[0].toUpperCase()}${noun.slice(1)}`;
    }
    if (COLUMN_LABELS[column]) return COLUMN_LABELS[column];
    return column.split('_')
        .map(w => ['sla', 'sap', 'ci', 'kb', 'id'].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
        .join(' ');
}

function formatValue(member, raw) {
    const { column } = splitMember(member);
    if (raw === null || raw === undefined || raw === '') return '—';
    const v = String(raw);

    if (column === 'count') return Number(v).toLocaleString();
    if (v === 'true') return 'Yes';
    if (v === 'false') return 'No';

    // "2026-08-14 08:44:55" -> "Aug 14, 2026, 8:44 AM"
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    // "2026-08-14" -> "Aug 14, 2026"
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // "2026-08" -> "August 2026"
    m = v.match(/^(\d{4})-(\d{2})$/);
    if (m) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
    // "2026-W33" -> "Week 33 of 2026"
    m = v.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `Week ${+m[2]} of ${m[1]}`;

    return v;
}

// One table cell; long text is cut short with the full value on hover
function cellHtml(member, raw, truncate) {
    const { column } = splitMember(member);
    const text = formatValue(member, raw);
    const isNumber = column === 'count';
    const cls = isNumber ? ' class="num"' : '';
    if (truncate && LONG_TEXT.has(column) && text.length > 120) {
        return `<td${cls} title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 117))}…</td>`;
    }
    return `<td${cls}>${escapeHtml(text)}</td>`;
}

function renderResults(rows, entity) {
    if (!rows.length) {
        return `<p class="result-empty">No matching records were found for that question.</p>`;
    }
    const columns = Object.keys(rows[0]);
    const [singular, plural] = ENTITY_NOUNS[entity] || ['record', 'records'];

    // A single number ("how many open P1s") reads best as a sentence
    if (rows.length === 1 && columns.length === 1 && columns[0].endsWith('.count')) {
        const n = Number(rows[0][columns[0]]);
        return `<div class="result-big">${n.toLocaleString()} <span>${n === 1 ? singular : plural}</span></div>`;
    }

    // A single record with many fields (ticket lookup) reads best as a field/value card
    if (rows.length === 1 && columns.length > 4) {
        const body = columns.map(c => {
            const { column } = splitMember(c);
            const text = formatValue(c, rows[0][c]);
            const cls = LONG_TEXT.has(column) ? ' class="long"' : '';
            return `<tr><th>${escapeHtml(columnLabel(c))}</th><td${cls}>${escapeHtml(text)}</td></tr>`;
        }).join('');
        return `<div class="table-wrap"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    }

    // Everything else: a normal table with a header row
    const head = columns.map(c => {
        const cls = c.endsWith('.count') ? ' class="num"' : '';
        return `<th${cls}>${escapeHtml(columnLabel(c))}</th>`;
    }).join('');
    const body = rows.map(r => `<tr>${columns.map(c => cellHtml(c, r[c], true)).join('')}</tr>`).join('');
    const caption = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}`;

    return `<div class="result-caption">${caption}</div>` +
        `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead>` +
        `<tbody>${body}</tbody></table></div>`;
}

function nounFor(entity, n) {
    const [singular, plural] = ENTITY_NOUNS[entity] || ['record', 'records'];
    return n === 1 ? singular : plural;
}

function capitalize(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Counts merged across ticket types (see combineResults in business_logic.mjs)
function renderCombined(combined) {
    const { dimension, entities, rows, totals } = combined;
    if (!rows.length) {
        return `<p class="result-empty">No matching tickets were found for that question.</p>`;
    }

    // No grouping: one row per ticket type, then the grand total
    if (!dimension) {
        const body = entities.map(e =>
            `<tr><td>${escapeHtml(capitalize(nounFor(e, 2)))}</td><td class="num">${(totals.counts[e] || 0).toLocaleString()}</td></tr>`
        ).join('');
        return `<div class="result-big">${totals.total.toLocaleString()} <span>${totals.total === 1 ? 'ticket' : 'tickets'}</span></div>` +
            `<div class="table-wrap"><table class="result-table"><thead><tr><th>Ticket Type</th><th class="num">Number of Tickets</th></tr></thead>` +
            `<tbody>${body}</tbody><tfoot><tr><td>Total</td><td class="num">${totals.total.toLocaleString()}</td></tr></tfoot></table></div>`;
    }

    // Grouped: the grouping column, one column per ticket type, and a total
    const typeHeads = entities.map(e => `<th class="num">${escapeHtml(capitalize(nounFor(e, 2)))}</th>`).join('');
    const head = `<th>${escapeHtml(columnLabel(dimension))}</th>${typeHeads}<th class="num">Total</th>`;
    const cell = n => `<td class="num">${n ? n.toLocaleString() : '—'}</td>`;
    const body = rows.map(r =>
        `<tr><td>${escapeHtml(formatValue(dimension, r.key))}</td>${entities.map(e => cell(r.counts[e])).join('')}` +
        `<td class="num total">${r.total.toLocaleString()}</td></tr>`
    ).join('');
    const foot = `<tr><td>Total</td>${entities.map(e => cell(totals.counts[e])).join('')}<td class="num">${totals.total.toLocaleString()}</td></tr>`;

    return `<div class="result-caption">${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}</div>` +
        `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead>` +
        `<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

// =====================================================================
// DOWNLOADS: the tables above -> PDF, Word, Excel, CSV, text, RTF or an archive
// =====================================================================

// Download payloads waiting for a click, keyed by the id of their download bar
const exportPayloads = new Map();
let exportCounter = 0;

function registerExport(payload) {
    const id = 'export-' + (++exportCounter);
    exportPayloads.set(id, payload);
    return id;
}

// Values as the user reads them, except counts stay real numbers so
// spreadsheets can sum them, and empty cells stay empty instead of "—"
function exportValue(member, raw) {
    if (raw === null || raw === undefined || raw === '') return '';
    if (splitMember(member).column === 'count') return Number(raw);
    return formatValue(member, raw);
}

// One result table in the export shape (mirrors renderResults, without truncation)
function exportTableFromRows(rows, title) {
    if (!rows || !rows.length) return null;
    const columns = Object.keys(rows[0]);

    // A single record is shown as a field/value card, so export it that way too
    if (rows.length === 1 && columns.length > 4) {
        return {
            title,
            columns: [{ label: 'Field' }, { label: 'Value' }],
            rows: columns.map(c => [columnLabel(c), String(exportValue(c, rows[0][c]))]),
            footer: null,
        };
    }
    return {
        title,
        columns: columns.map(c => ({ label: columnLabel(c), num: c.endsWith('.count') })),
        rows: rows.map(r => columns.map(c => exportValue(c, r[c]))),
        footer: null,
    };
}

// Mirrors renderCombined: one column per ticket type plus a total
function exportTableFromCombined(combined) {
    const { dimension, entities, rows, totals } = combined;
    if (!rows.length) return null;
    const typeLabel = e => capitalize(nounFor(e, 2));

    if (!dimension) {
        return {
            title: null,
            columns: [{ label: 'Ticket Type' }, { label: 'Number of Tickets', num: true }],
            rows: entities.map(e => [typeLabel(e), totals.counts[e] || 0]),
            footer: ['Total', totals.total],
        };
    }
    return {
        title: null,
        columns: [
            { label: columnLabel(dimension) },
            ...entities.map(e => ({ label: typeLabel(e), num: true })),
            { label: 'Total', num: true },
        ],
        rows: rows.map(r => [formatValue(dimension, r.key), ...entities.map(e => r.counts[e] || 0), r.total]),
        footer: ['Total', ...entities.map(e => totals.counts[e] || 0), totals.total],
    };
}

function buildExportTables(data) {
    let tables;
    if (data.combined) {
        tables = [exportTableFromCombined(data.combined)];
    } else if (data.sections && data.sections.length > 1) {
        tables = data.sections.map(s => exportTableFromRows(s.rows, capitalize(nounFor(s.entity, 2))));
    } else {
        tables = [exportTableFromRows(data.results || [], null)];
    }
    return tables.filter(Boolean);
}

const EXPORT_OPTIONS = [
    ['Documents', [
        ['xlsx', 'Excel (.xlsx)'],
        ['csv', 'CSV (.csv)'],
        ['pdf', 'PDF (.pdf)'],
        ['docx', 'Word (.docx)'],
        ['rtf', 'Rich Text (.rtf)'],
        ['txt', 'Plain Text (.txt)'],
    ]],
    ['Archives (all formats above in one file)', [
        ['zip', 'ZIP (.zip)'],
        ['7z', '7-Zip (.7z)'],
    ]],
];

function downloadBarHtml(exportId) {
    const options = EXPORT_OPTIONS.map(([group, items]) =>
        `<optgroup label="${escapeHtml(group)}">` +
        items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('') +
        `</optgroup>`
    ).join('');
    return `<div class="download-bar" id="${exportId}">` +
        `<label for="${exportId}-format">Download as</label>` +
        `<select id="${exportId}-format">${options}</select>` +
        `<button type="button" onclick="downloadExport('${exportId}')">⬇ Download</button>` +
        `<span class="download-status" role="status"></span>` +
        `</div>`;
}

async function downloadExport(exportId) {
    const payload = exportPayloads.get(exportId);
    const bar = document.getElementById(exportId);
    if (!payload || !bar) return;

    const format = bar.querySelector('select').value;
    const button = bar.querySelector('button');
    const status = bar.querySelector('.download-status');
    button.disabled = true;
    status.className = 'download-status';
    status.textContent = `Preparing ${format.toUpperCase()} file…`;

    try {
        const response = await fetch(`${API_BASE}/api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ ...payload, format }),
        });
        if (handleUnauthorized(response)) {
            status.textContent = '';
            return;
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `The server answered ${response.status}.`);
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/);
        const fileName = match ? match[1] : `one-touch-export.${format}`;

        // Hand the file to the browser through a temporary link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        status.textContent = `Downloaded ${fileName}`;
    } catch (err) {
        status.className = 'download-status error';
        status.textContent = `❌ ${err.message}`;
        console.error(err);
    } finally {
        button.disabled = false;
    }
}

// Element Node Builder Helper
let messageCounter = 0;
function appendMessage(cssClass, text) {
    const chatLog = document.getElementById('chat-log');
    const msgBlock = document.createElement('div');
    // A counter, not Date.now(): two messages added in the same millisecond
    // would share an id and the loading bubble could remove the wrong one
    const uniqueId = 'msg-' + (++messageCounter);
    
    msgBlock.id = uniqueId;
    msgBlock.className = `msg ${cssClass}`;
    msgBlock.innerHTML = text;
    
    chatLog.appendChild(msgBlock);
    chatLog.scrollTop = chatLog.scrollHeight; // Keep log automatically scrolled to bottom
    return uniqueId;
}
