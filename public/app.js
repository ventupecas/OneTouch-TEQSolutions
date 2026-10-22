// =====================================================================
// SIGN IN: the server checks the credentials and hands back a session
// token, which every API call then sends as "Authorization: Bearer ..."
// =====================================================================

// The API lives on the same server that served this page, whether that's
// localhost:8000, this computer's network address, or a tunnel link. Only a
// page opened straight from disk (file://) has no server, so fall back then.
const API_BASE = location.protocol.startsWith('http') ? location.origin : 'http://localhost:8000';
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

// Signed in: the home page, with this person's starred tickets
function showApp(signedIn) {
    document.body.classList.toggle('signed-out', !signedIn);
    if (signedIn) {
        switchTab('home');
        loadStars();
    } else {
        document.getElementById('login-email').focus();
    }
}

// The signed-in person's name, shown in the header and the greetings
// (their display name, or their username if they don't have one)
let currentUserName = '';
let currentUsername = '';

function setCurrentUser(user) {
    currentUserName = user ? (user.displayName || user.username || '') : '';
    currentUsername = user ? (user.username || '') : '';
    document.getElementById('user-name').textContent = currentUserName;
    renderGreetings();
    // Each person's home page opens on the search they used last
    if (currentUsername) setHomeMode(rememberedHomeMode());
}

// Just the first name: "Cassidy Sotelo" -> "Welcome, Cassidy!" on the home
// page and "Hello, Cassidy!" at the top of the chat
function renderGreetings() {
    const firstName = currentUserName.trim().split(/\s+/)[0];
    document.getElementById('home-welcome').textContent = firstName ? `Welcome, ${firstName}!` : 'Welcome!';
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
    // The next person to sign in on this computer must not see this person's
    // chat, searches or stars
    toggleAssistant(false);
    clearChat();
    setCurrentUser(null);
    resetHome();
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

// Bumped whenever the chat is cleared, so an answer still on its way for the
// old conversation is dropped instead of landing in the new one
let chatEpoch = 0;

// Back to just the greeting (with the signed-in person's name)
function clearChat() {
    chatEpoch += 1;
    document.getElementById('chat-log').innerHTML = WELCOME_HTML;
    forgetRemovedExports();
    renderGreetings();
    updateChatControls();
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

// "Delete chat": after a confirmation, the questions and answers disappear,
// Claude forgets the conversation, and the chat closes
async function deleteChat() {
    if (!document.querySelector('#chat-log .user-msg')) {
        toggleAssistant(false);
        return;
    }
    if (!confirm('Delete this chat? Its questions and answers disappear, and the AI assistant forgets the conversation.')) return;
    clearChat();
    toggleAssistant(false);
    await resetConversation();
    showToast('Chat deleted');
}

// The logo and the name "OneTouch": back to Home from anywhere, closing
// whatever is open on top (the chat, the dashboards drawer)
function goHome() {
    toggleAssistant(false);
    toggleDashboardDrawer(false);
    switchTab('home');
    document.getElementById('home-view').scrollTop = 0;
}

// Pages: Home (the logo) and Dashboards (its button); the AI assistant opens over either
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === viewName));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${viewName}-view`));
    if (viewName === 'dashboard') loadDashboards();
    // Stars may have changed elsewhere (the chat, a dashboard, another computer)
    if (viewName === 'home') {
        if (homeMode === 'starred') showStarred();
        else showTicketResults(true);
    }
}

// =====================================================================
// AI ASSISTANT: the chat opens over the page from Home's "Any question about
// the data" card (Open chat, or its example question). Minimize closes it and
// keeps the conversation; Delete chat removes it.
// =====================================================================

function assistantOpen() {
    return document.getElementById('assistant-panel').classList.contains('open');
}

// Opens or closes the conversation (no argument: the opposite of now)
function toggleAssistant(open) {
    const panel = document.getElementById('assistant-panel');
    const willOpen = typeof open === 'boolean' ? open : !assistantOpen();
    panel.classList.toggle('open', willOpen);
    document.getElementById('assistant-backdrop').classList.toggle('open', willOpen);
    document.getElementById('open-chat-btn').setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
        const chatLog = document.getElementById('chat-log');
        chatLog.scrollTop = chatLog.scrollHeight;
        document.getElementById('user-prompt').focus();
    } else if (panel.contains(document.activeElement)) {
        document.getElementById('open-chat-btn').focus();
    }
    updateChatControls();
}

// Asks a question as if typed into the chat, opening it to show the answer
function askAssistant(question) {
    toggleAssistant(true);
    document.getElementById('user-prompt').value = question;
    sendPrompt();
}

// Home's chat buttons: Open chat says how many questions the conversation has,
// and Delete chat appears once there is something to delete
function updateChatControls() {
    const asked = document.querySelectorAll('#chat-log .user-msg').length;
    document.getElementById('open-chat-btn').textContent = asked ? `💬 Open chat (${asked})` : '💬 Open chat';
    document.getElementById('delete-chat-btn').hidden = !asked;
}

// =====================================================================
// DASHBOARDS TAB: the Metabase dashboards made by scripts/metabase-setup.mjs,
// shown through the OneTouch server (so they work from any address)
// =====================================================================

const LAST_DASHBOARD_KEY = 'onetouch-dashboard';

// Every page the frame can show, by its public id: the drawer's dashboards,
// and the detail pages a click on a chart opens
const dashboardPages = { main: new Map(), details: new Map() };
let currentMainDashboard = null;
const pageId = path => (String(path).match(/\/public\/dashboard\/([0-9a-f-]{36})/) || [])[1];

// The last dashboard this browser showed (storage can be blocked: then none)
function rememberedDashboard() {
    try { return localStorage.getItem(LAST_DASHBOARD_KEY); } catch { return null; }
}
function rememberDashboard(key) {
    try { localStorage.setItem(LAST_DASHBOARD_KEY, key); } catch { /* not remembered; that's fine */ }
}

// Loads the drawer once; resolves true when the dashboards are there.
// Shared, so the tab and "Open in Dashboards" never load it twice.
let dashboardsLoading = null;
function loadDashboards() {
    if (!dashboardsLoading) {
        dashboardsLoading = buildDashboards().then(ok => {
            if (!ok) dashboardsLoading = null; // try again next time
            return ok;
        });
    }
    return dashboardsLoading;
}

async function buildDashboards() {
    const picker = document.getElementById('dashboard-picker');
    const message = document.getElementById('dashboard-message');
    try {
        const response = await fetch(`${API_BASE}/api/dashboards`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return false;
        const { dashboards, details = [] } = await response.json();
        for (const d of dashboards) dashboardPages.main.set(pageId(d.path), d);
        for (const d of details) dashboardPages.details.set(pageId(d.path), d);
        if (!dashboards.length) {
            message.textContent = 'No dashboards yet. Whoever runs this OneTouch server can create them with: ' +
                'docker exec analytics_node_app node scripts/metabase-setup.mjs';
            document.getElementById('dashboard-drawer-toggle').hidden = true;
            return false;
        }

        // The drawer: one heading per group, dashboards in the order the server lists them
        const groups = new Map();
        for (const d of dashboards) {
            if (!groups.has(d.group)) groups.set(d.group, []);
            groups.get(d.group).push(d);
        }
        picker.innerHTML = '';
        for (const [group, items] of groups) {
            const section = document.createElement('section');
            section.className = 'drawer-group';
            const heading = document.createElement('h3');
            heading.textContent = group;
            section.appendChild(heading);
            for (const d of items) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'dashboard-choice';
                button.dataset.key = d.key;
                button.innerHTML = '<span class="dashboard-choice-name"></span><span class="dashboard-choice-desc"></span>';
                button.querySelector('.dashboard-choice-name').textContent = d.name;
                button.querySelector('.dashboard-choice-desc').textContent = d.description || '';
                button.onclick = () => {
                    showDashboard(d);
                    toggleDashboardDrawer(false);
                };
                section.appendChild(button);
            }
            picker.appendChild(section);
        }

        const remembered = dashboards.find(d => d.key === rememberedDashboard());
        showDashboard(remembered || dashboards[0]);
        // First visit: open the drawer so people see everything that's there
        if (!remembered) toggleDashboardDrawer(true);
        return true;
    } catch (err) {
        message.textContent = 'Could not load the dashboards. Please try again.';
        console.error(err);
        return false;
    }
}

// The record pages a ticket number can open (built by scripts/metabase-setup.mjs)
const RECORD_PAGES = { INC: 'incident-detail', CHG: 'change-detail', RITM: 'request-detail' };

// Home page -> that ticket's record in the Dashboards tab
async function openInDashboards(number) {
    toggleAssistant(false); // opened from a ticket inside the chat: show the page behind it
    switchTab('dashboard');
    if (!await loadDashboards()) return;
    const key = RECORD_PAGES[(number.match(/^[A-Z]+/) || [])[0]];
    const page = [...dashboardPages.details.values()].find(d => d.key === key);
    if (!page) return;
    toggleDashboardDrawer(false);
    openDashboardPath(`${page.path}?number=${encodeURIComponent(number)}#titled=false&bordered=false`);
}

// Moves the frame to a page the way a click inside it would, so ← Back
// returns to the dashboard underneath. A frame still loading its first
// dashboard moves once that has loaded.
let pendingFramePath = null;
function frameHasPage() {
    try {
        return Boolean(pageId(document.getElementById('dashboard-frame').contentWindow.location.pathname));
    } catch { return false; }
}
function openDashboardPath(path) {
    if (frameHasPage()) document.getElementById('dashboard-frame').contentWindow.location.assign(`${API_BASE}${path}`);
    else pendingFramePath = path;
}
document.getElementById('dashboard-frame').addEventListener('load', () => {
    if (!pendingFramePath || !frameHasPage()) return;
    const path = pendingFramePath;
    pendingFramePath = null;
    // Not during the load event itself: a page moved before it has finished
    // loading replaces its history entry, and ← Back would then leave OneTouch
    setTimeout(() => document.getElementById('dashboard-frame').contentWindow.location.assign(`${API_BASE}${path}`), 50);
});

function showDashboard(dashboard) {
    markCurrentDashboard(dashboard);
    const frame = document.getElementById('dashboard-frame');
    // #bordered=false: no extra frame around the dashboard inside ours;
    // titled=false: the toolbar above already names it
    frame.src = `${API_BASE}${dashboard.path}#bordered=false&titled=false`;
    frame.hidden = false;
    document.getElementById('dashboard-message').hidden = true;
}

// A drawer dashboard is showing: name it, highlight it, remember it
function markCurrentDashboard(dashboard) {
    currentMainDashboard = dashboard;
    document.querySelectorAll('.dashboard-choice').forEach(b => {
        const on = b.dataset.key === dashboard.key;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    setDashboardHeading(dashboard.group, dashboard.name, dashboard.description || '', false);
    rememberDashboard(dashboard.key);
}

function setDashboardHeading(parent, name, description, onDetailPage) {
    document.getElementById('dashboard-current-group').textContent = parent;
    document.getElementById('dashboard-current-name').textContent = name;
    document.getElementById('dashboard-current-desc').textContent = description;
    document.getElementById('dashboard-back').hidden = !onDetailPage;
    document.getElementById('dashboard-hint').hidden = onDetailPage;
}

// "Team: TCS-Network-Voice", or for a list "Incidents · Priority: P2 - High"
function detailPageLabel(detail, search) {
    const values = new URLSearchParams(search);
    const set = detail.params.map(p => [p.name, values.get(p.slug)]).filter(([, v]) => v);
    if (detail.params.length === 1) return `${detail.name}: ${set[0]?.[1] || ''}`;
    return set.length ? `${detail.name} · ${set.map(([n, v]) => `${n}: ${v}`).join(', ')}` : detail.name;
}

// Clicks inside a dashboard move the frame to a detail page without
// reloading it, so follow its address and keep the toolbar in step
let lastFrameAddress = '';
function followDashboardFrame() {
    const frame = document.getElementById('dashboard-frame');
    let where;
    try { where = frame.contentWindow.location; } catch { return; } // not ours (yet)
    if (!where || where.href === lastFrameAddress) return;
    lastFrameAddress = where.href;

    const id = pageId(where.pathname);
    const main = dashboardPages.main.get(id);
    const detail = dashboardPages.details.get(id);
    if (main) {
        if (main !== currentMainDashboard) markCurrentDashboard(main);
        else setDashboardHeading(main.group, main.name, main.description || '', false);
    } else if (detail) {
        // Every filter cleared (the × in the filter box): the page has nothing to
        // show, so go back to the dashboard it was opened from. replace(), so ← Back
        // doesn't return to the empty page.
        const values = new URLSearchParams(where.search);
        if (!detail.params.some(p => values.get(p.slug))) {
            const home = currentMainDashboard || [...dashboardPages.main.values()][0];
            if (home) {
                frame.contentWindow.location.replace(`${API_BASE}${home.path}#bordered=false&titled=false`);
                showToast(`No filters left, so you're back on ${home.name}`);
                return;
            }
        }
        setDashboardHeading(currentMainDashboard ? currentMainDashboard.name : '', detailPageLabel(detail, where.search), '', true);
    }

    // An incident, change or request record can be starred from the toolbar
    const star = document.getElementById('dashboard-star');
    const number = detail && detail.params.some(p => p.slug === 'number')
        ? String(new URLSearchParams(where.search).get('number') || '').toUpperCase() : '';
    star.hidden = !STARRABLE.test(number);
    if (!star.hidden) {
        star.dataset.star = number;
        paintStar(star);
    }
}
setInterval(followDashboardFrame, 400);
document.getElementById('dashboard-frame').addEventListener('load', followDashboardFrame);

function dashboardBack() {
    // Only from a detail page: on a drawer dashboard there is nothing to go back to
    // inside the frame, and history.back() would leave OneTouch's page instead
    if (document.getElementById('dashboard-back').hidden) return;
    document.getElementById('dashboard-frame').contentWindow.history.back();
}

// Opens or closes the drawer (no argument: the opposite of now)
function toggleDashboardDrawer(open) {
    const drawer = document.getElementById('dashboard-drawer');
    const toggle = document.getElementById('dashboard-drawer-toggle');
    const willOpen = typeof open === 'boolean' ? open : !drawer.classList.contains('open');
    drawer.classList.toggle('open', willOpen);
    document.getElementById('dashboard-backdrop').classList.toggle('open', willOpen);
    toggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
        (drawer.querySelector('.dashboard-choice.active') || drawer.querySelector('.dashboard-choice'))?.focus();
    } else if (drawer.contains(document.activeElement)) {
        toggle.focus();
    }
}

// Escape closes whatever is open on top: the conversation, then the drawer
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (assistantOpen()) toggleAssistant(false);
    else if (document.getElementById('dashboard-drawer').classList.contains('open')) toggleDashboardDrawer(false);
});

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

    // Shows each step while the answer is worked out, with a running clock
    const progress = startQueryProgress();
    const epoch = chatEpoch;

    try {
        // text/event-stream: the server reports each step as it happens
        const response = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        if (handleUnauthorized(response)) {
            progress.finish();
            return;
        }

        const data = await readQueryResponse(response, stage => progress.step(stage));
        const seconds = progress.finish();
        if (epoch !== chatEpoch) return; // the chat was deleted or restarted meanwhile

        if (data.memoryReset) {
            appendMessage('system-msg', 'This conversation got long, so Claude started fresh. Earlier questions are no longer remembered.');
        }

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${escapeHtml(data.error)}`);
            return;
        }

        // Clarification or unsupported question: show the explanation only
        if (data.intent === 'clarify' || data.intent === 'unsupported') {
            appendMessage('ai-msg', `🙋 ${escapeHtml(data.message || 'I need a little more detail to run that.')}` + answerTimingHtml(seconds, data.fromCache));
            return;
        }

        // Normal query: restate what was fetched, show the rows as a table,
        // and tuck the assumptions into a collapsible note underneath
        let html = `<div class="result-title">${escapeHtml(data.message || 'Here is what I found:')}</div>`;
        // Nothing found anywhere: the server's explanation replaces the empty tables
        const explanationHtml = data.explanation
            ? `<div class="result-explanation">${escapeHtml(data.explanation)}</div>` : '';
        if (data.explanation && data.allEmpty) {
            html += explanationHtml;
        } else if (data.combined) {
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
        // Some ticket types found nothing: explain those under the tables
        if (data.explanation && !data.allEmpty) html += explanationHtml;

        if (data.assumptions && data.assumptions.length > 0) {
            html += `<details class="assumptions"><summary>How I read your question</summary><ul>` +
                data.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('') +
                `</ul></details>`;
        }

        // Star every ticket the answer lists, or all of one type
        html += starAllHtml(answerTicketNumbers(data));

        // Offer the same tables as a download in any of the export formats
        const tables = buildExportTables(data);
        if (tables.length) {
            html += downloadBarHtml(registerExport({
                title: data.message || 'One Touch results',
                question: userPromptText,
                tables,
            }));
        }

        const answerId = appendMessage('ai-msg wide', html + answerTimingHtml(seconds, data.fromCache));

        // Parent / child tickets and others linked to the ones in this answer, under it
        const primary = answerTicketNumbers(data);
        if (primary.length) showRelated(document.getElementById(answerId), primary, true);

        // The tickets in this answer pop up in Ticket results on Home
        if (data.shownTickets && data.shownTickets.length) ticketsShown(data.shownTickets);

    } catch (err) {
        progress.finish();
        if (epoch !== chatEpoch) return;
        appendMessage('ai-msg', `❌ Could not reach the OneTouch server, or the answer was cut off. Please try again.`);
        console.error(err);
    }
}

// =====================================================================
// PROGRESS: what the server is doing with the question, step by step
// =====================================================================

// [while it runs, once it's done]
const QUERY_STEPS = {
    sending: ['📨 Sending your question…', 'Sent your question'],
    understanding: ['🧠 Understanding your question…', 'Understood your question'],
    cached: ['⚡ Asked before: reusing that answer…', 'Reused the earlier answer (no AI wait)'],
    querying: ['📊 Getting the data…', 'Got the data'],
    explaining: ['🔎 Nothing matched; working out why…', 'Worked out why'],
};

// A chat bubble listing finished steps (with how long each took) and the
// current one with a running clock. finish() removes it and returns the total seconds.
function startQueryProgress() {
    const started = performance.now();
    const steps = []; // { stage, at }
    const id = appendMessage('ai-msg query-progress', '');
    const bubble = document.getElementById(id);
    const secs = ms => `${(ms / 1000).toFixed(1)} s`;

    function render() {
        const now = performance.now();
        bubble.innerHTML = steps.map((s, i) => {
            const end = steps[i + 1] ? steps[i + 1].at : now;
            return i < steps.length - 1
                ? `<div class="progress-done">✓ ${escapeHtml(QUERY_STEPS[s.stage][1])} <span class="progress-time">${secs(end - s.at)}</span></div>`
                : `<div class="progress-current">${escapeHtml(QUERY_STEPS[s.stage][0])} <span class="progress-time">${secs(now - started)}</span></div>`;
        }).join('');
    }

    function step(stage) {
        if (!QUERY_STEPS[stage] || steps.some(s => s.stage === stage)) return;
        steps.push({ stage, at: performance.now() });
        render();
    }

    step('sending');
    const timer = setInterval(render, 100);
    return {
        step,
        finish() {
            clearInterval(timer);
            bubble.remove();
            updateChatControls();
            return (performance.now() - started) / 1000;
        },
    };
}

// The server's answer: server-sent events, a "progress" event per step and then
// the "result". A refusal before the question starts (e.g. a 400) is plain JSON.
async function readQueryResponse(response, onStep) {
    if (!(response.headers.get('Content-Type') || '').includes('text/event-stream')) {
        return response.json();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        // Events end with a blank line
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const name = (block.match(/^event: (.*)$/m) || [])[1];
            const data = (block.match(/^data: (.*)$/m) || [])[1];
            if (!data) continue;
            if (name === 'progress') onStep(JSON.parse(data).stage);
            else if (name === 'result') result = JSON.parse(data);
        }
        if (done) break;
    }
    if (!result) throw new Error('The answer was cut off.');
    return result;
}

// "Answered in 2.8 s", or for a repeated question "⚡ Answered in 0.2 s …"
function answerTimingHtml(seconds, fromCache) {
    const time = `${seconds.toFixed(1)} s`;
    return fromCache
        ? `<div class="result-timing">⚡ Answered in ${time}: this question was asked before, so the AI step was skipped</div>`
        : `<div class="result-timing">Answered in ${time}</div>`;
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
    parent_incident: 'Parent Incident',
    problem: 'Problem Record',
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
    // A ticket number gets a star next to it
    return `<td${cls}>${escapeHtml(text)}${starFor(raw)}</td>`;
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
            return `<tr><th>${escapeHtml(columnLabel(c))}</th><td${cls}>${escapeHtml(text)}${starFor(rows[0][c])}</td></tr>`;
        }).join('');
        return `<div class="table-wrap"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    }

    // Everything else: a normal table with a header row. A row with a ticket number
    // opens, on click, into that ticket's full record and related tickets.
    const head = columns.map(c => {
        const cls = c.endsWith('.count') ? ' class="num"' : '';
        return `<th${cls}>${escapeHtml(columnLabel(c))}</th>`;
    }).join('');
    const numberColumn = columns.find(c => c.endsWith('.number'));
    const body = rows.map(r => {
        const number = numberColumn && STARRABLE.test(String(r[numberColumn])) ? String(r[numberColumn]) : null;
        if (!number) return `<tr>${columns.map(c => cellHtml(c, r[c], true)).join('')}</tr>`;
        const cells = columns.map(c => c === numberColumn
            ? `<td class="ticket-cell"><span class="expand-caret" aria-hidden="true">▸</span>${escapeHtml(number)}${starButtonHtml(number)}</td>`
            : cellHtml(c, r[c], true)).join('');
        return `<tr class="expandable" data-expand="${escapeHtml(number)}" tabindex="0" aria-expanded="false"` +
            ` title="Click to see ${escapeHtml(number)}'s full record and related tickets">${cells}</tr>`;
    }).join('');
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

// Downloads whose bar is gone (chat cleared, a newer search) are dropped
function forgetRemovedExports() {
    for (const id of exportPayloads.keys()) {
        if (!document.getElementById(id)) exportPayloads.delete(id);
    }
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

function downloadBarHtml(exportId, label = 'Download as') {
    const options = EXPORT_OPTIONS.map(([group, items]) =>
        `<optgroup label="${escapeHtml(group)}">` +
        items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('') +
        `</optgroup>`
    ).join('');
    return `<div class="download-bar" id="${exportId}">` +
        `<label for="${exportId}-format">${escapeHtml(label)}</label>` +
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
            // The browser's time zone: the file's "Generated" time and date use it
            body: JSON.stringify({ ...payload, format, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
    updateChatControls();
    return uniqueId;
}

// =====================================================================
// STARRED TICKETS: kept with each person's account on the server, so they
// follow them to any computer. Any ticket number shown anywhere (search
// results, the assistant's tables, a dashboard record) can be starred.
// =====================================================================

const STARRABLE = /^(INC|CHG|RITM|SCTASK)\d{7}$/;
const starredTickets = new Map(); // number -> when it was starred, newest first
let starsLoading = null;

// Fetches this person's stars (again); everything already on screen is repainted
function loadStars() {
    if (!sessionTokenValue) return Promise.resolve();
    if (!starsLoading) {
        const token = sessionTokenValue;
        starsLoading = (async () => {
            try {
                const response = await fetch(`${API_BASE}/api/stars`, { headers: authHeaders() });
                if (handleUnauthorized(response)) return;
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
                if (token !== sessionTokenValue) return; // signed out meanwhile
                starredTickets.clear();
                for (const s of data.stars) starredTickets.set(s.number, s.starredAt);
                refreshStarButtons();
            } catch (err) {
                console.error('Could not load starred tickets:', err);
            } finally {
                starsLoading = null;
            }
        })();
    }
    return starsLoading;
}

function starFace(on, labelled) {
    return (on ? '★' : '☆') + (labelled ? (on ? ' Starred' : ' Star') : '');
}

function starButtonHtml(number, labelled = false) {
    const on = starredTickets.has(number);
    const label = `${on ? 'Unstar' : 'Star'} ${number}`;
    return `<button type="button" class="star-btn${labelled ? ' labelled' : ''}${on ? ' on' : ''}" data-star="${escapeHtml(number)}"` +
        ` aria-pressed="${on}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${starFace(on, labelled)}</button>`;
}

// A star after a value, if the value is a ticket number
function starFor(raw) {
    const value = String(raw ?? '');
    return STARRABLE.test(value) ? starButtonHtml(value) : '';
}

function paintStar(button) {
    const number = button.dataset.star;
    const on = starredTickets.has(number);
    const label = `${on ? 'Unstar' : 'Star'} ${number}`;
    button.textContent = starFace(on, button.classList.contains('labelled'));
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.title = label;
    button.setAttribute('aria-label', label);
}

function refreshStarButtons() {
    document.querySelectorAll('.star-btn[data-star]').forEach(paintStar);
    document.querySelectorAll('.star-many').forEach(paintStarMany);
    document.getElementById('star-count').textContent = starredTickets.size.toLocaleString();
}

// ---------------------------------------------------------------------
// "Star all": every ticket in a list, or all of one type in it
// ---------------------------------------------------------------------

const KIND_NOUNS = { INC: ['incident', 'incidents'], CHG: ['change', 'changes'], RITM: ['request', 'requests'], SCTASK: ['catalog task', 'catalog tasks'] };
const kindOf = number => (number.match(/^[A-Z]+/) || [''])[0];

// The bar: "★ Star all 30 tickets", then one button per type when the list mixes
// types. Nothing for fewer than two tickets (each row has its own star).
function starAllHtml(numbers) {
    const list = [...new Set(numbers)].filter(n => STARRABLE.test(n));
    if (list.length < 2) return '';
    const byKind = new Map();
    for (const n of list) {
        if (!byKind.has(kindOf(n))) byKind.set(kindOf(n), []);
        byKind.get(kindOf(n)).push(n);
    }
    const buttons = [starManyButtonHtml(list, byKind.size === 1 ? kindOf(list[0]) : '')];
    if (byKind.size > 1) for (const [kind, nums] of byKind) buttons.push(starManyButtonHtml(nums, kind));
    return `<div class="star-all-bar">${buttons.join('')}</div>`;
}

// "28 changes", "1 incident", "30 tickets"
function starManyWhat(numbers, kind) {
    const nouns = KIND_NOUNS[kind] || ['ticket', 'tickets'];
    return `${numbers.length.toLocaleString()} ${nouns[numbers.length === 1 ? 0 : 1]}`;
}

// "★ Star all 28 changes", or once they all are, "✓ 28 changes starred"
function starManyState(numbers, kind) {
    const what = starManyWhat(numbers, kind);
    const done = numbers.every(n => starredTickets.has(n));
    return { done, text: done ? `✓ ${what} starred` : (numbers.length === 1 ? `★ Star ${what}` : `★ Star all ${what}`) };
}

// The numbers are ticket numbers (checked by starAllHtml), so they need no escaping
function starManyButtonHtml(numbers, kind) {
    const s = starManyState(numbers, kind);
    return `<button type="button" class="star-many" data-star-many="${numbers.join(',')}" data-kind="${kind}"${s.done ? ' disabled' : ''}>${escapeHtml(s.text)}</button>`;
}

function paintStarMany(button) {
    const s = starManyState(button.dataset.starMany.split(','), button.dataset.kind);
    button.textContent = s.text;
    button.disabled = s.done;
}

// Stars them in one request; the screen changes at once, and back if the server says no
async function starMany(numbers, what) {
    const toAdd = numbers.filter(n => STARRABLE.test(n) && !starredTickets.has(n));
    if (!toAdd.length) return;
    const now = new Date().toISOString();
    for (const n of toAdd) starredTickets.set(n, now);
    refreshStarButtons();
    try {
        const response = await fetch(`${API_BASE}/api/stars`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers: toAdd }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        const starred = new Set(data.starred);
        const leftOut = toAdd.filter(n => !starred.has(n));
        for (const n of leftOut) starredTickets.delete(n);
        refreshStarButtons();
        showToast(leftOut.length
            ? `★ Starred ${(toAdd.length - leftOut.length).toLocaleString()}; ${leftOut.length.toLocaleString()} more would pass the limit of 2,000 starred tickets. Unstar some first.`
            : `★ Starred ${what}`);
    } catch (err) {
        for (const n of toAdd) starredTickets.delete(n);
        refreshStarButtons();
        showToast(`❌ ${err.message}`);
    }
}

// The tickets an AI answer is about: its ticket-number column, not related
// numbers in other columns (e.g. a task's parent request)
function answerTicketNumbers(data) {
    const sections = data.sections && data.sections.length ? data.sections : [{ rows: data.results || [] }];
    const numbers = [];
    for (const s of sections) {
        for (const row of s.rows) {
            for (const [member, value] of Object.entries(row)) {
                if (member.endsWith('.number') && STARRABLE.test(String(value))) numbers.push(String(value));
            }
        }
    }
    return numbers;
}

// Changes on screen at once, and back again if the server says no
async function setStarred(number, on) {
    if (!STARRABLE.test(number) || starredTickets.has(number) === on) return true;
    const before = starredTickets.get(number);
    if (on) starredTickets.set(number, new Date().toISOString());
    else starredTickets.delete(number);
    refreshStarButtons();
    try {
        const response = await fetch(`${API_BASE}/api/stars/${encodeURIComponent(number)}`, {
            method: on ? 'PUT' : 'DELETE',
            headers: authHeaders(),
        });
        if (handleUnauthorized(response)) return false;
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `The server answered ${response.status}.`);
        }
        return true;
    } catch (err) {
        if (on) starredTickets.delete(number);
        else starredTickets.set(number, before);
        refreshStarButtons();
        showToast(`❌ ${err.message}`);
        return false;
    }
}

// A short message at the bottom of the screen
let toastTimer = null;
function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// =====================================================================
// HOME PAGE: the latest ticket search from the search bar, and your
// starred tickets
// =====================================================================

const HOME_MODES = ['results', 'starred'];
let homeMode = 'results';
// Each search bumps its counter, so an older, slower answer can't replace a newer one
const homeRuns = { results: 0, starred: 0 };

// The list each person had open last, remembered in this browser
function homeModeKey() {
    return `onetouch-home-mode:${currentUsername}`;
}
function rememberedHomeMode() {
    try { return localStorage.getItem(homeModeKey()) || 'results'; } catch { return 'results'; }
}

// Shows one of Home's lists and loads it (quiet: refresh it without a "Loading…")
function setHomeMode(mode, quiet = false) {
    if (!HOME_MODES.includes(mode)) mode = 'results';
    homeMode = mode;
    document.querySelectorAll('.home-mode').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    for (const m of HOME_MODES) document.getElementById(`home-${m}`).hidden = m !== mode;
    if (currentUsername) {
        try { localStorage.setItem(homeModeKey(), mode); } catch { /* not remembered; that's fine */ }
    }
    if (mode === 'starred') showStarred();
    else showTicketResults(quiet);
}

// Signing out leaves nothing of this person's on the page
function resetHome() {
    for (const m of HOME_MODES) homeRuns[m] += 1;
    latestShown = new Set();
    openedRecord = null;
    document.getElementById('ticket-results').innerHTML = NO_TICKET_RESULTS_HTML;
    document.getElementById('starred-result').innerHTML = '';
    starredTickets.clear();
    refreshStarButtons();
    setHomeMode('results');
    forgetRemovedExports();
}

// -> { found, notFound, ignored, tooMany, record? }, or null if the session ended
async function searchTickets(text, record = false) {
    const response = await fetch(`${API_BASE}/api/tickets/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text, record }),
    });
    if (handleUnauthorized(response)) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
    return data;
}

// The columns of every ticket list; the getters give the text people read
const TICKET_COLUMNS = [
    ['Ticket', t => t.number],
    ['Type', t => t.type],
    ['Summary', t => t.summary],
    ['State', t => t.state],
    ['Priority / Risk', t => t.level],
    ['Team', t => t.team],
    ['Assigned To / Requested For', t => t.person],
    ['Opened', t => t.opened ? formatValue('ticket.opened', t.opened) : ''],
];
const STARRED_COLUMN = ['Starred', t => formatStarredAt(starredTickets.get(t.number))];

function formatStarredAt(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Ticket numbers open the ticket; every row has a star. Rows whose number is
// in `highlight` (e.g. the latest answer's tickets) get `highlightClass`.
function ticketTableHtml(tickets, columns = TICKET_COLUMNS, highlight = new Set(), highlightClass = 'fresh') {
    const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('');
    const body = tickets.map(t => (highlight.has(t.number) ? `<tr class="${highlightClass}">` : '<tr>') + columns.map(([label, get], i) => {
        if (i === 0) {
            return `<td class="ticket-cell"><button type="button" class="ticket-link" data-ticket="${escapeHtml(t.number)}"` +
                ` title="Open ${escapeHtml(t.number)}">${escapeHtml(t.number)}</button>${starButtonHtml(t.number)}</td>`;
        }
        const text = String(get(t) || '');
        if (label === 'Summary' && text.length > 120) {
            return `<td title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 117))}…</td>`;
        }
        return `<td>${escapeHtml(text || '—')}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function ticketDownloadHtml(tickets, title, columns = TICKET_COLUMNS) {
    return downloadBarHtml(registerExport({
        title,
        tables: [{
            title: null,
            columns: columns.map(([label]) => ({ label })),
            rows: tickets.map(t => columns.map(([, get]) => String(get(t) || ''))),
            footer: null,
        }],
    }));
}

// One ticket: its heading, a star, a link to its dashboard record, and every field it has
function ticketCardHtml(t, record) {
    const dashboardButton = RECORD_PAGES[t.kind]
        ? `<button type="button" class="home-action" data-open-dashboard="${escapeHtml(t.number)}">Open in Dashboards ↗</button>` : '';
    let html = `<div class="ticket-head">` +
        `<span class="ticket-type">${escapeHtml(t.type)}</span>` +
        `<span class="ticket-number">${escapeHtml(t.number)}</span>` +
        starButtonHtml(t.number, true) + dashboardButton +
        `</div>` +
        (t.summary ? `<div class="ticket-summary">${escapeHtml(t.summary)}</div>` : '');

    if (!record) return html + ticketTableHtml([t]) + ticketDownloadHtml([t], t.number);

    const fields = Object.entries(record.fields);
    const body = fields.map(([member, value]) => {
        const cls = LONG_TEXT.has(splitMember(member).column) ? ' class="long"' : '';
        return `<tr><th>${escapeHtml(columnLabel(member))}</th><td${cls}>${escapeHtml(formatValue(member, value))}${starFor(value)}</td></tr>`;
    }).join('');
    html += `<div class="table-wrap tall"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    html += downloadBarHtml(registerExport({
        title: `${t.type} ${t.number}`,
        tables: [{
            title: null,
            columns: [{ label: 'Field' }, { label: 'Value' }],
            rows: fields.map(([member, value]) => [columnLabel(member), String(exportValue(member, value))]),
            footer: null,
        }],
    }));
    return html;
}


// Runs one search into one result box, showing progress and errors there.
// quiet: keep what's showing until the new content is ready (background refresh).
async function runHomeSearch(mode, outId, work, quiet = false) {
    const run = ++homeRuns[mode];
    const out = document.getElementById(outId);
    if (!quiet) out.innerHTML = '<p class="home-status">Loading…</p>';
    try {
        const html = await work();
        if (run !== homeRuns[mode] || html === null) return;
        out.innerHTML = html;
    } catch (err) {
        if (run !== homeRuns[mode]) return;
        out.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
    forgetRemovedExports();
}

// =====================================================================
// TICKET RESULTS: every ticket the person has been shown, newest first: the
// tickets in the AI assistant's answers (the server records them as it
// answers) and records they opened. Kept with their account, so the list is
// there after a refresh, signing out, or on another computer.
// =====================================================================

const NO_TICKET_RESULTS_HTML = '<p class="home-status">Tickets in the AI assistant\'s answers show up here automatically, ' +
    'and stay here after you refresh or sign out. Click a ticket number to see its full record.</p>';

let latestShown = new Set(); // the latest answer's tickets, highlighted in the list
let openedRecord = null;     // a ticket whose full record is showing instead of the list

const SHOWN_COLUMNS = [
    ['Shown', t => formatShownAt(t.shownAt)],
    ['From', t => t.question || 'Opened from a ticket number'],
];

// "Oct 22, 1:05 PM"
function formatShownAt(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

// The list (or the record someone opened). quiet: refresh without a "Loading…".
function showTicketResults(quiet = false) {
    const out = document.getElementById('ticket-results');
    if (!sessionTokenValue) { out.innerHTML = NO_TICKET_RESULTS_HTML; return; }
    if (openedRecord) return showOpenedRecord(openedRecord);
    return runHomeSearch('results', 'ticket-results', async () => {
        const response = await fetch(`${API_BASE}/api/seen-tickets`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        const tickets = data.tickets || [];
        if (!tickets.length) return NO_TICKET_RESULTS_HTML;
        const columns = [...TICKET_COLUMNS, ...SHOWN_COLUMNS];
        const fresh = tickets.filter(t => latestShown.has(t.number)).length;
        return '<div class="results-head">' +
            `<p class="home-status">${tickets.length.toLocaleString()} ${tickets.length === 1 ? 'ticket' : 'tickets'} shown to you, newest first. ` +
            (fresh ? `<span class="fresh-key">Highlighted: the ${fresh.toLocaleString()} from your latest question.</span> ` : '') +
            'Click a ticket number to see its full record.</p>' +
            `<button type="button" class="home-action danger" onclick="deleteTicketResults(${tickets.length})">🗑 Delete ticket results</button></div>` +
            starAllHtml(tickets.map(t => t.number)) +
            ticketTableHtml(tickets, columns, latestShown) + ticketDownloadHtml(tickets, 'Ticket results', columns);
    }, quiet);
}

// A ticket number someone clicked: its full record, with the way back to the list.
// Opening it counts as being shown, so it joins the list.
function openTicketRecord(number) {
    openedRecord = number;
    toggleAssistant(false); // clicked inside the chat (e.g. in a related family): show Home
    switchTab('home');
    setHomeMode('results');
    if (STARRABLE.test(number)) {
        fetch(`${API_BASE}/api/seen-tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers: [number] }),
        }).catch(err => console.error('Could not add the ticket to Ticket results:', err));
    }
    document.getElementById('home-view').scrollTop = 0;
}

async function showOpenedRecord(number) {
    await runHomeSearch('results', 'ticket-results', async () => {
        const data = await searchTickets(number, true);
        if (!data) return null;
        const back = '<div class="home-actions"><button type="button" class="home-action" onclick="closeTicketRecord()">← All ticket results</button></div>';
        if (!data.found.length) return back + `<p class="home-status">${escapeHtml(number)} is not in the data.</p>`;
        if (data.found.length === 1) return back + ticketCardHtml(data.found[0], data.record);
        return back + ticketTableHtml(data.found);
    });
    // Its parent / child tickets and other linked ones, under the record
    const out = document.getElementById('ticket-results');
    if (openedRecord === number && out.querySelector('.ticket-head')) showRelated(out, [number], false);
}

// =====================================================================
// RELATED TICKETS: the families the server finds from the links in the data
// (parent / child incidents, bundle and child requests, an order's requests,
// a request's tasks, a change and its incidents, a problem record), with what
// the members share and where they differ
// =====================================================================

const FAMILY_COLUMNS = [
    ['Ticket', t => t.number],
    ['Role', t => t.role],
    ['Summary', t => t.summary],
    ['State', t => t.state],
    ['Priority / Risk', t => t.level],
    ['Team', t => t.team],
    ['Opened', t => t.opened ? formatValue('ticket.opened', t.opened) : ''],
];

// "Team ACN-INFRA-CLOUD-LINUX (3), ACN-SAP-BASIS (3)", "Opened Sep 1, 1:07 AM to 1:18 AM"
function familyFact(fact) {
    if (fact.range) return `${formatValue('ticket.opened', fact.range[0])} to ${formatValue('ticket.opened', fact.range[1])}`;
    if (fact.note) return fact.note;
    if (fact.values) {
        return fact.values.map(v => `${v.value} (${v.count.toLocaleString()})`).join(', ') + (fact.others ? `, and ${fact.others.toLocaleString()} more` : '');
    }
    const value = fact.field === 'Opened' ? formatValue('ticket.opened', fact.value) : String(fact.value);
    return value.length > 100 ? `${value.slice(0, 97)}…` : value;
}

const FAMILY_MEMBERS_SHOWN = 25; // listed on screen; downloads hold every member
const FAMILY_EXPORT_COLUMNS = [...FAMILY_COLUMNS.slice(0, 2), ['Type', t => t.type], ...FAMILY_COLUMNS.slice(2)];

// A family as download tables: every member, then what they share and where they differ.
// Titles start with what the table is and the family's anchor number, because
// Excel cuts worksheet names at 31 characters ("Members of PRB0051839 (96 tick…").
function familyExportTables(f) {
    return [
        {
            title: `Members of ${f.anchor} (${f.title})`,
            columns: FAMILY_EXPORT_COLUMNS.map(([label]) => ({ label })),
            rows: f.members.map(t => FAMILY_EXPORT_COLUMNS.map(([, get]) => String(get(t) || ''))),
            footer: null,
        },
        {
            title: `Same or different in ${f.anchor} (${f.title})`,
            columns: [{ label: 'Field' }, { label: 'Same or different' }, { label: 'Value' }],
            rows: [
                ...f.same.map(fact => [fact.field, `Same in all ${f.total.toLocaleString()}`, familyFact(fact)]),
                ...f.differ.map(fact => [fact.field, 'Different', familyFact(fact)]),
            ],
            footer: null,
        },
    ].filter(table => table.rows.length);
}

// "Related to INC1813970", or "Related to INC1, INC2, INC3 and 4 more"
function relatedToLabel(focus) {
    const list = [...focus];
    return `Related to ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
}

// `focus`: the tickets the question or record was about, marked in each family
function relatedHtml(families, focus) {
    const about = relatedToLabel(focus);
    // Several families: one file with all of them, besides each family's own
    const all = families.length > 1
        ? downloadBarHtml(registerExport({ title: `Related tickets: ${families.length} families`, question: about, tables: families.flatMap(familyExportTables) }),
            `Download all ${families.length} families as`)
        : '';
    return '<div class="related"><div class="related-title">🔗 Related tickets</div>' + all + families.map(f => {
        const facts = list => list.map(fact => `<span class="fact"><b>${escapeHtml(fact.field)}:</b> ${escapeHtml(familyFact(fact))}</span>`).join('');
        const same = f.same.length
            ? `<div class="family-line"><span class="same-label">Same in all ${f.total.toLocaleString()}</span>${facts(f.same)}</div>` : '';
        const differ = f.differ.length
            ? `<div class="family-line"><span class="differ-label">Different</span>${facts(f.differ)}</div>` : '';
        const shown = f.members.slice(0, FAMILY_MEMBERS_SHOWN);
        const more = f.members.length > shown.length
            ? `<p class="family-more">Showing ${shown.length.toLocaleString()} of ${f.members.length.toLocaleString()}; the comparison above and the download cover all of them.</p>` : '';
        const download = downloadBarHtml(registerExport({ title: f.title, question: about, tables: familyExportTables(f) }), 'Download this family as');
        return `<section class="family"><div class="family-title">${escapeHtml(f.title)}</div>` +
            `<p class="family-why">${escapeHtml(f.why)}</p>${same}${differ}` +
            ticketTableHtml(shown, FAMILY_COLUMNS, focus, 'focus') + more + download + '</section>';
    }).join('') + '</div>';
}

// Adds "Related tickets" to the end of `container` (an AI answer, or a record on
// Home) once the server has looked; nothing at all if there are none.
// conversation: true also tells the AI about them with the next question.
async function showRelated(container, numbers, conversation) {
    const slot = document.createElement('div');
    slot.className = 'related-slot';
    slot.innerHTML = '<p class="related-loading">🔗 Looking for related tickets…</p>';
    container.appendChild(slot);
    try {
        const response = await fetch(`${API_BASE}/api/tickets/related`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers, conversation }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        if (!slot.isConnected) return; // the chat was cleared, or another record opened
        if (!data.families.length) { slot.remove(); return; }
        slot.innerHTML = relatedHtml(data.families, new Set(numbers));
        // Keep the newest answer in view, as the chat does for new messages
        const chatLog = document.getElementById('chat-log');
        if (chatLog.contains(slot) && chatLog.lastElementChild === container) chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
        slot.remove();
        console.error('Could not look for related tickets:', err);
    }
}

function closeTicketRecord() {
    openedRecord = null;
    showTicketResults();
}

// "Delete ticket results": after a confirmation, the whole list goes, on every
// computer. Stars are separate and stay; new answers fill the list again.
async function deleteTicketResults(count) {
    const what = `${count.toLocaleString()} ${count === 1 ? 'ticket' : 'tickets'}`;
    if (!confirm(`Delete your ticket results? The list of ${what} is cleared on every computer you use. Your starred tickets stay starred.`)) return;
    try {
        const response = await fetch(`${API_BASE}/api/seen-tickets`, { method: 'DELETE', headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        latestShown = new Set();
        openedRecord = null;
        await showTicketResults();
        showToast('Ticket results deleted');
    } catch (err) {
        showToast(`❌ ${err.message}`);
    }
}

// An AI answer showed these tickets (the server has already saved them): they
// go to the top of Ticket results, highlighted, and Home shows that list
function ticketsShown(numbers) {
    latestShown = new Set(numbers);
    openedRecord = null;
    setHomeMode('results', true);
    showToast(`🎫 ${numbers.length.toLocaleString()} ${numbers.length === 1 ? 'ticket' : 'tickets'} from this answer ${numbers.length === 1 ? 'is' : 'are'} now in Ticket results on Home`);
}

// Newest star first. Unstarring here leaves the row (with an empty star) until
// the list is opened again, so a slip of the mouse is easy to undo.
function showStarred() {
    return runHomeSearch('starred', 'starred-result', async () => {
        await loadStars();
        const numbers = [...starredTickets.keys()];
        if (!numbers.length) {
            return '<p class="home-status">No starred tickets yet. Click ☆ next to any ticket number: in your ticket results, ' +
                'in the AI assistant\'s answers, or on an incident, change or request record in Dashboards. ' +
                'Your stars are saved to your account, so they are here on any computer you sign in from.</p>';
        }
        const data = await searchTickets(numbers.join(' '));
        if (!data) return null;
        const columns = [...TICKET_COLUMNS, STARRED_COLUMN];
        const missing = data.notFound.length
            ? `<p class="home-status">Not in the data any more: ${escapeHtml(data.notFound.join(', '))}</p>` : '';
        return `<p class="home-status">${numbers.length.toLocaleString()} starred ${numbers.length === 1 ? 'ticket' : 'tickets'}, newest first.</p>` +
            ticketTableHtml(data.found, columns) + missing + ticketDownloadHtml(data.found, 'Starred tickets', columns);
    });
}

// One listener for every star, ticket link and record button, wherever it was drawn
document.addEventListener('click', e => {
    const star = e.target.closest('.star-btn[data-star]');
    if (star) { setStarred(star.dataset.star, !starredTickets.has(star.dataset.star)); return; }

    const many = e.target.closest('.star-many');
    if (many) {
        const numbers = many.dataset.starMany.split(',');
        starMany(numbers, starManyWhat(numbers, many.dataset.kind));
        return;
    }

    const ticket = e.target.closest('[data-ticket]');
    if (ticket) { openTicketRecord(ticket.dataset.ticket); return; }

    // Home's example question is asked in the chat
    const example = e.target.closest('[data-example]');
    if (example) { askAssistant(example.dataset.example); return; }

    const record = e.target.closest('[data-open-dashboard]');
    if (record) { openInDashboards(record.dataset.openDashboard); return; }

    const close = e.target.closest('.row-detail-close');
    if (close) { toggleTicketRow(close.closest('tr.row-detail').previousElementSibling); return; }

    // A ticket's row in an AI answer: open (or fold away) its full record and
    // related tickets. Buttons and menus inside the row keep their own jobs.
    const row = e.target.closest('tr.expandable');
    if (row && !e.target.closest('button, a, select, input, label')) toggleTicketRow(row);
});

// The same from the keyboard: Enter or Space on a focused ticket row
document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr.expandable')) {
        e.preventDefault();
        toggleTicketRow(e.target);
    }
});

// =====================================================================
// TICKET ROWS IN AI ANSWERS: a click opens a detailed view under the row:
// the ticket's full record, then its related tickets (families)
// =====================================================================

function toggleTicketRow(row) {
    const open = row.nextElementSibling;
    if (open && open.classList.contains('row-detail')) {
        open.remove();
        row.classList.remove('expanded');
        row.setAttribute('aria-expanded', 'false');
        return;
    }
    const number = row.dataset.expand;
    const detail = document.createElement('tr');
    detail.className = 'row-detail';
    const cell = document.createElement('td');
    cell.colSpan = row.cells.length;
    cell.innerHTML = `<div class="row-detail-body"><button type="button" class="row-detail-close">▴ Close</button>` +
        `<div class="row-detail-content"><p class="home-status">Loading ${escapeHtml(number)}…</p></div></div>`;
    detail.appendChild(cell);
    row.after(detail);
    row.classList.add('expanded');
    row.setAttribute('aria-expanded', 'true');
    loadTicketDetail(cell.querySelector('.row-detail-content'), number);
}

async function loadTicketDetail(box, number) {
    try {
        const data = await searchTickets(number, true);
        if (!data || !box.isConnected) return;
        if (!data.found.length) {
            box.innerHTML = `<p class="home-status">${escapeHtml(number)} is not in the data.</p>`;
            return;
        }
        box.innerHTML = ticketCardHtml(data.found[0], data.record);
        showRelated(box, [number], false);
    } catch (err) {
        if (box.isConnected) box.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
}

// =====================================================================
// START: a token from earlier in this tab skips the sign-in page; if it
// has expired, the first API call returns 401 and brings the page back
// =====================================================================

document.getElementById('ticket-results').innerHTML = NO_TICKET_RESULTS_HTML;
showApp(Boolean(sessionTokenValue));
loadCurrentUser();

// A reload empties the chat on screen, so Claude forgets it too
resetConversation();
