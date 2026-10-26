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

// Signed in: the home page, with this person's starred tickets, layout and colors
function showApp(signedIn) {
    document.body.classList.toggle('signed-out', !signedIn);
    if (signedIn) {
        switchTab('home');
        loadStars();
        loadPreferences();
    } else if (!fillSignInLink()) {
        document.getElementById('login-email').focus();
    }
}

// A sign-in link (…/#user=jsmith&pass=secret) fills in the form, and the
// person still clicks the button. The part after "#" is never sent to the
// server (or the tunnel), and it is taken out of the address bar at once.
let signInLink = null;
function readSignInLink() {
    let details = location.hash.slice(1);
    // Some apps escape the "=" and "&" when they open a link (#user%3Djsmith%26pass%3D…)
    if (!/[=&]/.test(details) && /%3D/i.test(details)) {
        try { details = decodeURIComponent(details); } catch { /* read as it is */ }
    }
    const params = new URLSearchParams(details);
    if (!params.has('user')) return false;
    signInLink = { user: params.get('user') || '', pass: params.get('pass') || '' };
    history.replaceState(null, '', location.pathname + location.search);
    return true;
}
function fillSignInLink() {
    if (!signInLink || !document.body.classList.contains('signed-out')) return false;
    document.getElementById('login-email').value = signInLink.user;
    document.getElementById('login-password').value = signInLink.pass;
    // A link with just the username: the password is typed next
    document.getElementById(signInLink.pass ? 'login-btn' : 'login-password').focus();
    signInLink = null;
    showLoginError('');
    return true;
}
// Opened while someone is signed in in this tab: their session stays, and the
// form is filled in when they sign out
function signInLinkWhileSignedIn() {
    if (!signInLink || !currentUsername) return;
    const user = signInLink.user.trim().toLowerCase().replace(/@molsoncoors\.com$/, '');
    if (user === currentUsername) signInLink = null;
    else showToast(`That link signs in as ${user}. You're signed in as ${currentUsername}: sign out to use it.`);
}
window.addEventListener('hashchange', () => {
    if (!readSignInLink()) return;
    if (!fillSignInLink()) signInLinkWhileSignedIn();
});

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
        if (response.ok) {
            setCurrentUser(await response.json());
            signInLinkWhileSignedIn();
        }
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
    resetCustomizing();
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
// Claude's answers, so follow-ups ("same but for changes") work, and saves
// each chat to the person's account after every answer. "New chat" starts
// a fresh one; the old one stays under "Earlier chats", where reopening it
// shows its answers again and Claude remembers it.
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
    toggleChatHistory(false);
    renderGreetings();
    updateChatControls();
}

// remove: also delete the chat from the history ("Delete chat")
async function resetConversation(remove = false) {
    if (!sessionTokenValue) return;
    try {
        const response = await fetch(`${API_BASE}/api/conversation/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ delete: remove }),
        });
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
// Claude forgets the conversation, it leaves the history, and the chat closes
async function deleteChat() {
    if (!document.querySelector('#chat-log .user-msg')) {
        toggleAssistant(false);
        return;
    }
    if (!confirm('Delete this chat? Its questions and answers disappear, it leaves your earlier chats, and the AI assistant forgets the conversation.')) return;
    clearChat();
    toggleAssistant(false);
    await resetConversation(true);
    showToast('Chat deleted');
}

// ---------------------------------------------------------------------
// EARLIER CHATS: the list over the chat, newest first. Opening one draws
// its answers again and Claude carries on with it.
// ---------------------------------------------------------------------

function chatHistoryOpen() {
    return !document.getElementById('chat-history').hidden;
}

function toggleChatHistory(open) {
    const box = document.getElementById('chat-history');
    const willOpen = typeof open === 'boolean' ? open : box.hidden;
    box.hidden = !willOpen;
    document.getElementById('chat-history-btn').setAttribute('aria-expanded', String(willOpen));
    if (willOpen) loadChatHistory();
}

function formatChatWhen(iso) {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

async function loadChatHistory() {
    const list = document.getElementById('chat-history-list');
    list.innerHTML = '<p class="home-status">Loading your earlier chats…</p>';
    try {
        const response = await fetch(`${API_BASE}/api/chats`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your earlier chats.');
        if (!chatHistoryOpen()) return;
        list.innerHTML = data.chats.length
            ? data.chats.map(c => `
                <div class="chat-history-item${c.current ? ' current' : ''}">
                    <button type="button" class="chat-history-open" onclick="openSavedChat(${c.id})" title="${c.current ? 'This is the chat you have open' : 'Open this chat and carry on where you left off'}">
                        <span class="chat-history-title">${escapeHtml(c.title)}</span>
                        <span class="chat-history-meta">${c.current ? 'Open now · ' : ''}${c.questions} ${c.questions === 1 ? 'question' : 'questions'} · ${escapeHtml(formatChatWhen(c.updatedAt))}</span>
                    </button>
                    <button type="button" class="chat-history-delete" onclick="deleteSavedChat(${c.id})" title="Delete this chat" aria-label="Delete this chat">🗑</button>
                </div>`).join('')
            : '<p class="home-status">No earlier chats yet. Each chat is saved here after its first answer.</p>';
    } catch (err) {
        list.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
}

// Shows a saved chat's questions and answers, and Claude remembers it again
async function openSavedChat(id) {
    try {
        const response = await fetch(`${API_BASE}/api/chats/${id}/open`, { method: 'POST', headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not open that chat.');
        clearChat();
        for (const entry of data.transcript) {
            appendMessage('user-msg', escapeHtml(entry.question));
            const reply = entry.reply || {};
            showAnswer(entry.question, reply, reply.elapsedMs ? reply.elapsedMs / 1000 : null, { replay: true });
        }
        document.getElementById('user-prompt').focus();
    } catch (err) {
        showToast(err.message);
        loadChatHistory();
        console.error(err);
    }
}

async function deleteSavedChat(id) {
    if (!confirm('Delete this chat? It leaves your earlier chats and can\'t be brought back.')) return;
    try {
        const response = await fetch(`${API_BASE}/api/chats/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not delete that chat.');
        // The open chat was the one deleted: the screen starts over too
        if (data.current) {
            clearChat();
            toggleChatHistory(true);
        } else {
            loadChatHistory();
        }
        showToast('Chat deleted');
    } catch (err) {
        showToast(err.message);
        console.error(err);
    }
}

// The logo and the name "OneTouch": back to Home from anywhere, closing
// whatever is open on top (the chat, the dashboards drawer)
function goHome() {
    toggleAssistant(false);
    toggleDashboardDrawer(false);
    toggleThemePanel(false);
    switchTab('home');
    document.getElementById('home-view').scrollTop = 0;
}

// Pages: Home (the logo, or its button) and Dashboards; the page showing lights up.
// The AI assistant opens over either.
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === viewName));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${viewName}-view`));
    // The first time someone sees Dashboards: its tour (customize.js)
    if (viewName === 'dashboard') loadDashboards().then(() => maybeStartTour('dashboards'));
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

// Every page the frame can show, by its public id: the drawer's dashboards,
// and the detail pages a click on a chart opens
const dashboardPages = { main: new Map(), details: new Map() };
let currentMainDashboard = null;
const pageId = path => (String(path).match(/\/public\/dashboard\/([0-9a-f-]{36})/) || [])[1];

// The dashboard each person had open last ("my:<id>" for one of their own),
// saved to their account so it opens there next time, on any computer
function rememberedDashboard() {
    return prefs.dashboards.last || '';
}
function rememberDashboard(key) {
    if (prefs.dashboards.last === key || !sessionTokenValue || prefsLoadFailed) return;
    prefs.dashboards.last = key;
    savePreference('dashboards');
}

// How the frame shows a dashboard: no extra border or title (the toolbar
// above names it), and Metabase's dark look when OneTouch is dark
function frameHash() {
    return `#bordered=false&titled=false${document.documentElement.dataset.theme === 'dark' ? '&theme=night' : ''}`;
}

// A page's own hash with OneTouch's look in it, keeping everything else it
// says (a detail page hides some of its filters there). Kept as written,
// because Metabase reads it without turning "+" into spaces.
function themedFrameHash(hash) {
    const options = hash.replace(/^#/, '').split('&').filter(o => o && !o.startsWith('theme='));
    if (document.documentElement.dataset.theme === 'dark') options.push('theme=night');
    return `#${options.join('&')}`;
}
const frameHashIsDark = hash => /(^#|&)theme=night(&|$)/.test(hash);

// Light <-> dark: the dashboard in the frame reloads in the matching look
function refreshDashboardTheme() {
    if (!frameHasPage()) return;
    try {
        const where = document.getElementById('dashboard-frame').contentWindow.location;
        where.replace(`${where.pathname}${where.search}${themedFrameHash(where.hash)}`);
        where.reload();
    } catch { /* not ours */ }
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
        // Which team dashboards this person hid, and which one they had open
        await prefsReady;
        if (!dashboards.length) {
            message.textContent = 'No team dashboards yet. Whoever runs this OneTouch server can create them with: ' +
                'docker exec analytics_node_app node scripts/metabase-setup.mjs. You can still build your own under ☰ Dashboards.';
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
                button.innerHTML = '<span class="choice-check" aria-hidden="true"></span><span class="dashboard-choice-name"></span><span class="dashboard-choice-desc"></span>';
                button.querySelector('.dashboard-choice-name').textContent = d.name;
                button.querySelector('.dashboard-choice-desc').textContent = d.description || '';
                button.onclick = () => {
                    // "Show or hide team dashboards": a click shows or hides it in the list
                    if (drawerEditing) return toggleDashboardHidden(d.key);
                    showDashboard(d);
                    toggleDashboardDrawer(false);
                };
                section.appendChild(button);
            }
            picker.appendChild(section);
        }

        applyHiddenDashboards();

        const last = rememberedDashboard();
        if (last === 'families') { showFamilies(); return true; }
        if (last.startsWith('my:') && showBoard(last.slice(3))) return true;
        const remembered = dashboards.find(d => d.key === last && !isDashboardHidden(d.key));
        if (remembered) showDashboard(remembered);
        else showFirstDashboard();
        // First visit: open the drawer so people see everything that's there
        // (unless the Dashboards tour is about to show it to them)
        if (!last && (prefs.tour.dashboards || prefsLoadFailed)) toggleDashboardDrawer(true);
        return true;
    } catch (err) {
        message.textContent = 'Could not load the dashboards. Please try again.';
        console.error(err);
        return false;
    }
}

// The first team dashboard in this person's list; with every one hidden, a
// dashboard of their own, or a note saying how to bring the team ones back
function showFirstDashboard() {
    const visible = [...dashboardPages.main.values()].filter(d => !isDashboardHidden(d.key));
    if (visible.length) return showDashboard(visible[0]);
    if (prefs.dashboards.boards.length) return showBoard(prefs.dashboards.boards[0].id);
    hideBoard();
    document.getElementById('dashboard-frame').hidden = true;
    const message = document.getElementById('dashboard-message');
    message.textContent = 'Every team dashboard is hidden from your list. Open ☰ Dashboards and click "Show or hide team dashboards" ' +
        'to bring some back, or create a dashboard of your own.';
    message.hidden = false;
    setDashboardHeading('', '', '', false);
    document.getElementById('dashboard-hint').hidden = true;
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
    const path = `${page.path}?number=${encodeURIComponent(number)}${frameHash()}`;
    if (currentBoardId || document.getElementById('dashboard-frame').hidden) {
        // One of their own dashboards is showing: back to the team dashboards, and
        // the record opens on top of one once it has loaded (so ← Back works)
        const visible = [...dashboardPages.main.values()].filter(d => !isDashboardHidden(d.key));
        showDashboard(visible.includes(currentMainDashboard) ? currentMainDashboard : visible[0] || [...dashboardPages.main.values()][0]);
        pendingFramePath = path;
    } else {
        openDashboardPath(path);
    }
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
    hideBoard();
    hideFamilies();
    showRecordFamily('');
    markCurrentDashboard(dashboard);
    const frame = document.getElementById('dashboard-frame');
    frame.src = `${API_BASE}${dashboard.path}${frameHash()}`;
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
    if (frame.hidden) return; // one of their own dashboards is showing
    let where;
    try { where = frame.contentWindow.location; } catch { return; } // not ours (yet)
    if (!where) return;
    // A click's link can't know OneTouch is dark, so its page opens light: put the
    // look back in place (no reload, and ← Back still returns to the page before)
    const id = pageId(where.pathname);
    if (id && frameHashIsDark(where.hash) !== (document.documentElement.dataset.theme === 'dark')) {
        where.replace(`${where.pathname}${where.search}${themedFrameHash(where.hash)}`);
        return;
    }
    if (where.href === lastFrameAddress) return;
    lastFrameAddress = where.href;

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
                frame.contentWindow.location.replace(`${API_BASE}${home.path}${frameHash()}`);
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
    // …and its parent, children and other linked tickets above it (families.js)
    showRecordFamily(star.hidden ? '' : number);
}
setInterval(followDashboardFrame, 400);
document.getElementById('dashboard-frame').addEventListener('load', followDashboardFrame);

// Follows a click inside the frame as it happens rather than at the next
// look, so a page that opened light turns dark before it is seen
document.getElementById('dashboard-frame').addEventListener('load', () => {
    try {
        const w = document.getElementById('dashboard-frame').contentWindow;
        if (w.oneTouchFollows) return;
        w.oneTouchFollows = true;
        const pushState = w.history.pushState;
        w.history.pushState = function (...args) {
            pushState.apply(this, args);
            queueMicrotask(followDashboardFrame);
        };
        w.addEventListener('popstate', () => setTimeout(followDashboardFrame));
    } catch { /* not ours */ }
});

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

// Escape closes whatever is open on top: the colors panel, the conversation,
// then the drawer (a dialog such as the chart builder closes itself)
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!document.getElementById('theme-panel').hidden) toggleThemePanel(false);
    else if (assistantOpen() && chatHistoryOpen()) toggleChatHistory(false);
    else if (assistantOpen()) toggleAssistant(false);
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
    appendMessage('user-msg', escapeHtml(userPromptText));
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

        showAnswer(userPromptText, data, seconds);

    } catch (err) {
        progress.finish();
        if (epoch !== chatEpoch) return;
        appendMessage('ai-msg', `❌ Could not reach the OneTouch server, or the answer was cut off. Please try again.`);
        console.error(err);
    }
}

// One answer in the chat. replay: drawn again from a saved chat, so it
// doesn't tell Claude about related tickets again or add to Ticket results.
function showAnswer(userPromptText, data, seconds, { replay = false } = {}) {
    if (data.memoryReset) {
        appendMessage('system-msg', 'This conversation got long, so Claude started fresh. Earlier questions are no longer remembered.');
    }

    if (data.error) {
        appendMessage('ai-msg', `❌ Error: ${escapeHtml(data.error)}`);
        return;
    }

    // Clarification or unsupported question: show the explanation only
    if (data.intent === 'clarify' || data.intent === 'unsupported') {
        const message = data.message || 'I need a little more detail to run that.';
        const download = downloadBarHtml(registerExport({ title: 'OneTouch answer', question: userPromptText, tables: buildExportTables(data, message) }));
        appendMessage('ai-msg', `🙋 ${escapeHtml(message)}` + download + answerTimingHtml(seconds, data.fromCache));
        return;
    }

    // Normal query: restate what was fetched, show the rows as a table,
    // and tuck the assumptions into a collapsible note underneath
    let html = `<div class="result-title">${escapeHtml(data.message || 'Here is what I found:')}</div>`;
    // Nothing found anywhere: the server's explanation replaces the empty tables
    const explanationHtml = data.explanation
        ? `<div class="result-explanation">${escapeHtml(data.explanation)}</div>` : '';
    let tablesHtml = '';
    if (data.rowsDropped) {
        // A long saved chat keeps only its newer answers' tables (chats.mjs)
        html += '<div class="result-explanation">This answer\'s tables were too large to keep in the chat history. Ask the question again to see them.</div>';
    } else if (data.explanation && data.allEmpty) {
        html += explanationHtml;
    } else if (data.combined) {
        // Counts across several ticket types: one table, one column per type
        tablesHtml = renderCombined(data.combined);
    } else if (data.sections && data.sections.length > 1) {
        // Lists across several ticket types: one titled table per type
        tablesHtml = data.sections.map(s =>
            `<div class="section-title">${escapeHtml(capitalize(nounFor(s.entity, 2)))}</div>` +
            renderResults(s.rows, s.entity)
        ).join('');
    } else {
        tablesHtml = renderResults(data.results || [], data.entity);
    }
    // Counts by one thing can also be shown as a chart (and back)
    const answer = { data, question: userPromptText, tablesHtml, view: 'table', model: tablesHtml ? answerChartModel(data, userPromptText) : null };
    if (tablesHtml) html += (answer.model ? answerViewsHtml(answer.model, data.chartable) : '') + `<div class="answer-view">${tablesHtml}</div>`;
    // Some ticket types found nothing: explain those under the tables
    if (data.explanation && !data.allEmpty && !data.rowsDropped) html += explanationHtml;

    if (data.assumptions && data.assumptions.length > 0) {
        html += `<details class="assumptions"><summary>How I read your question</summary><ul>` +
            data.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('') +
            `</ul></details>`;
    }

    // Star every ticket the answer lists, or all of one type
    html += starAllHtml(answerTicketNumbers(data));

    // Offer the same tables as a download in any of the export formats, and,
    // while a chart is showing, a picture of it (also placed in PDF, Word and Excel)
    const tables = data.rowsDropped ? [] : buildExportTables(data);
    if (tables.length) {
        html += downloadBarHtml(registerExport({
            title: data.message || 'One Touch results',
            question: userPromptText,
            tables,
            picture: answer.model ? () => answerPicture(answer) : undefined,
        }), 'Download as', { pictures: Boolean(answer.model) });
    }

    const answerId = appendMessage('ai-msg wide', html + answerTimingHtml(seconds, data.fromCache));
    const answerEl = document.getElementById(answerId);
    answerEl._answer = answer;
    paintPictureOptions(answerEl);

    // Parent / child tickets and others linked to the ones in this answer, under it
    const primary = answerTicketNumbers(data);
    if (primary.length) showRelated(answerEl, primary, !replay);

    // The tickets in this answer pop up in Ticket results on Home
    if (!replay && data.shownTickets && data.shownTickets.length) ticketsShown(data.shownTickets);
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
// (nothing for a saved answer whose time wasn't kept)
function answerTimingHtml(seconds, fromCache) {
    if (seconds == null) return '';
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
    // A ticket number opens that ticket (its record and family), with a star next to it
    return `<td${cls}>${ticketValueHtml(raw, text)}</td>`;
}

// A value that is a ticket number (a parent, a request, a change…): a link that
// opens that ticket's record and family, and its star. self: the record's own number.
function ticketValueHtml(raw, text, self = null) {
    const value = String(raw ?? '');
    if (/^(INC|CHG|RITM|SCTASK|REQ)\d{7}$/.test(value) && value !== self) {
        return `<button type="button" class="ticket-link" data-ticket="${escapeHtml(value)}" title="Open ${escapeHtml(value)}: its record and family">${escapeHtml(text)}</button>${starFor(raw)}`;
    }
    return `${escapeHtml(text)}${starFor(raw)}`;
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
            return `<tr><th>${escapeHtml(columnLabel(c))}</th><td${cls}>${ticketValueHtml(rows[0][c], text)}</td></tr>`;
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

// =====================================================================
// AI ANSWERS AS CHARTS: an answer that counts one ticket type by one thing
// (or compares ticket types) can be shown as columns, bars, a line, a donut
// and back to the table. One that is exactly a chart (chartable from the
// server) can be saved to Home or a dashboard, and a click on its chart
// lists the tickets behind a bar or slice.
// =====================================================================

const ANSWER_VIEW_NAMES = { table: 'Table', bar: 'Columns', hbar: 'Sideways bars', line: 'Line', area: 'Area', donut: 'Donut', stacked: 'Stacked columns' };
const STACKED_ICON = '<rect x="4" y="13" width="5" height="8" rx="1"/><rect x="4" y="6" width="5" height="6" rx="1" opacity="0.5"/><rect x="14" y="9" width="5" height="12" rx="1"/><rect x="14" y="3" width="5" height="5" rx="1" opacity="0.5"/>';
// More than this many categories: the biggest are drawn, the rest add up in a note
const MAX_ANSWER_BARS = 30;

// -> { kind: 'single', chart, data, views, drill } | { kind: 'series', chart, series, views } | null
function answerChartModel(data, question) {
    const title = data.message || question;
    const base = { id: 'answer', title, color: 'accent', size: 'large', status: 'all', filters: [], dates: { preset: 'all' } };
    const rows = data.results || [];
    // One ticket type counted by one field
    if (!data.combined && data.entity !== 'multiple' && rows.length >= 2) {
        const columns = Object.keys(rows[0]);
        const counts = columns.filter(c => c.endsWith('.count'));
        const fields = columns.filter(c => !c.endsWith('.count'));
        if (counts.length === 1 && fields.length === 1) {
            const field = splitMember(fields[0]).column;
            const time = isTimeField(field);
            const list = rows.map(r => ({ value: r[fields[0]] ?? null, count: Number(r[counts[0]]) || 0 }));
            const total = list.reduce((t, r) => t + r.count, 0);
            let other = null;
            if (time) list.sort((a, b) => String(a.value).localeCompare(String(b.value)));
            else if (list.length > MAX_ANSWER_BARS) {
                list.sort((a, b) => b.count - a.count);
                const rest = list.splice(MAX_ANSWER_BARS);
                other = { count: rest.reduce((t, r) => t + r.count, 0), groups: rest.length };
            }
            return {
                kind: 'single',
                chart: { ...base, source: data.entity, groupBy: field, display: time ? 'line' : 'bar', limit: list.length },
                data: { total, rows: list, other },
                views: time ? ['table', 'line', 'area', 'bar'] : ['table', 'bar', 'hbar', 'donut', 'line'],
                drill: data.chartable && !data.chartable.dropped.length ? data.chartable.chart : null,
            };
        }
    }
    const combined = data.combined;
    if (combined && combined.rows.length) {
        const { dimension, entities, totals } = combined;
        const name = e => capitalize(nounFor(e, 2));
        // A total per ticket type
        if (!dimension && entities.length >= 2) {
            return {
                kind: 'single',
                chart: { ...base, source: 'tickets', groupBy: 'ticket_type', display: 'bar', limit: entities.length },
                data: { total: totals.total, rows: entities.map(e => ({ value: name(e), count: totals.counts[e] || 0, slot: ENTITY_SLOTS[e] || 1 })), other: null },
                views: ['table', 'bar', 'hbar', 'donut'],
                drill: null,
            };
        }
        // Ticket types side by side, per week, team, ...
        if (dimension && combined.rows.length >= 2) {
            const time = isTimeField(splitMember(dimension).column);
            const ordered = time ? [...combined.rows].sort((a, b) => String(a.key).localeCompare(String(b.key))) : combined.rows;
            return {
                kind: 'series',
                chart: { ...base, groupLabel: columnLabel(dimension) },
                series: {
                    categories: ordered.map(r => ({ value: r.key, label: time ? periodLabel(dimension, r.key) : formatValue(dimension, r.key) })),
                    series: entities.map(e => ({ name: name(e), slot: ENTITY_SLOTS[e] || 1, values: ordered.map(r => r.counts[e] || 0) })),
                    total: totals.total,
                },
                views: time ? ['table', 'line', 'bar', 'stacked'] : ['table', 'bar', 'stacked', 'line'],
            };
        }
    }
    return null;
}

function answerViewsHtml(model, chartable) {
    const icon = view => {
        const svg = view === 'stacked' ? STACKED_ICON : (DISPLAY_CHOICES.find(([v]) => v === view) || [])[2] || '';
        return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">${svg}</svg>`;
    };
    const buttons = model.views.map(v => `<button type="button" class="view-btn${v === 'table' ? ' active' : ''}" data-answer-view="${v}" aria-pressed="${v === 'table'}">` +
        `${icon(v)}<span>${ANSWER_VIEW_NAMES[v]}</span></button>`).join('');
    const save = model.kind === 'single' && chartable
        ? '<button type="button" class="view-btn save" data-answer-save title="Put this on Home or one of your dashboards, as a chart that stays">📌 Save as a chart</button>' : '';
    return `<div class="answer-views" role="group" aria-label="Show this answer as"><span class="answer-views-label">Show as</span>${buttons}${save}</div>`;
}

function setAnswerView(el, view) {
    const answer = el._answer;
    if (!answer?.model || !answer.model.views.includes(view)) return;
    answer.view = view;
    el.querySelectorAll('[data-answer-view]').forEach(b => {
        const on = b.dataset.answerView === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    const box = el.querySelector('.answer-view');
    resizeWatcher.unobserve(box);
    box._drawn = null;
    box._pick = null;
    if (view === 'table') {
        box.className = 'answer-view';
        box.innerHTML = answer.tablesHtml;
        refreshStarButtons();
    } else {
        box.className = 'answer-view tile-body answer-chart';
        const model = answer.model;
        if (model.kind === 'series') drawSeriesChart(box, model.chart, model.series, view);
        else drawChart(box, { ...model.chart, display: view }, model.data, false);
        // An answer that is exactly a chart: a click lists the tickets behind a mark
        if (model.drill) box._pick = row => openDrill({ chart: model.drill, value: row ? row.value : null, label: row ? groupLabel(model.drill, row.value, true) : '' });
        box.classList.toggle('drillable', Boolean(box._pick));
        if (model.data?.other) {
            box.insertAdjacentHTML('beforeend', `<p class="chart-note">${escapeHtml(`Showing the biggest ${model.data.rows.length}; the other ${model.data.other.groups.toLocaleString()} add up to ${model.data.other.count.toLocaleString()} (all of them are in the table).`)}</p>`);
        }
    }
    paintPictureOptions(el);
}

// The picture of the answer's chart, while one is showing
function answerPicture(answer) {
    if (!answer.model || answer.view === 'table') return null;
    const model = answer.model;
    const subtitle = `Question: ${answer.question}`;
    return model.kind === 'series'
        ? { chart: model.chart, series: model.series, display: answer.view, title: model.chart.title, subtitle }
        : { chart: { ...model.chart, display: answer.view }, data: model.data, title: model.chart.title, subtitle };
}

// "📌 Save as a chart": the chart builder, filled in from the answer, saving to Home or a dashboard
function saveAnswerChart(el) {
    const answer = el._answer;
    const chartable = answer?.data.chartable;
    if (!chartable) return;
    const display = ['bar', 'hbar', 'line', 'area', 'donut'].includes(answer.view) ? answer.view : chartable.chart.display;
    toggleAssistant(false);
    openBuilder({
        chart: { ...chartable.chart, id: newChartId(), title: '', display },
        note: chartable.dropped.length
            ? `From the answer. Not carried over, because a chart can't hold it: ${chartable.dropped.join('; ')}. The chart counts without it.`
            : 'From the answer: the same numbers. Change anything you like, then choose where to save it.',
        destination: true,
        onSave: saveChartTo,
    });
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

// Every kind of answer downloads: its tables, why something was empty, and how
// the question was read (notes: kept out of CSV files that have data). A
// text-only answer (a question back, or something the data can't answer)
// downloads as its text.
function buildExportTables(data, textAnswer = null) {
    let tables;
    if (textAnswer) {
        tables = [noteTable('Answer', 'Answer', [textAnswer])];
    } else if (data.combined) {
        tables = [exportTableFromCombined(data.combined)];
    } else if (data.sections && data.sections.length > 1) {
        tables = data.sections.map(s => exportTableFromRows(s.rows, capitalize(nounFor(s.entity, 2))));
    } else {
        tables = [exportTableFromRows(data.results || [], null)];
    }
    tables = tables.filter(Boolean);
    if (data.explanation) {
        tables.push(noteTable(data.allEmpty ? 'Why nothing was found' : 'Why some of it is empty', 'Explanation', [data.explanation]));
    }
    if (data.assumptions && data.assumptions.length) {
        tables.push(noteTable('How I read your question', 'Assumption', data.assumptions));
    }
    return tables;
}

function noteTable(title, label, lines) {
    return { title, note: true, columns: [{ label }], rows: lines.map(l => [String(l)]), footer: null };
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

// Pictures of the chart (drawn in the browser by charts.js)
const PICTURE_FORMATS = ['png', 'svg'];
const PICTURE_OPTIONS = ['Picture of the chart', [['png', 'Picture (.png)'], ['svg', 'Picture, any size (.svg)']]];
// Formats that also carry the chart picture, when a chart is showing
const FORMATS_WITH_PICTURE = ['pdf', 'docx', 'xlsx', 'rtf', 'zip', '7z'];

// pictures: the result can be shown as a chart, so offer its picture too
function downloadBarHtml(exportId, label = 'Download as', { pictures = false } = {}) {
    const groups = pictures ? [EXPORT_OPTIONS[0], PICTURE_OPTIONS, ...EXPORT_OPTIONS.slice(1)] : EXPORT_OPTIONS;
    const options = groups.map(([group, items]) =>
        `<optgroup label="${escapeHtml(group)}">` +
        items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('') +
        `</optgroup>`
    ).join('');
    return `<div class="download-bar" id="${exportId}">` +
        `<label for="${exportId}-format">${escapeHtml(label)}</label>` +
        `<select id="${exportId}-format">${options}</select>` +
        `<button type="button" onclick="downloadExport('${exportId}')">⬇ Download</button>` +
        `<span class="download-status" role="status"></span>` +
        (pictures ? '<span class="download-note" data-picture-note></span>' : '') +
        `</div>`;
}

// The picture choices work while a chart is showing; with the table showing,
// they say how to get one
function paintPictureOptions(container) {
    const bar = container.querySelector(':scope > .download-bar, .answer-download .download-bar, .tile-download .download-bar') || container.querySelector('.download-bar');
    if (!bar) return;
    const payload = exportPayloads.get(bar.id);
    const on = Boolean(payload?.picture?.());
    bar.querySelectorAll('option').forEach(o => {
        if (!PICTURE_FORMATS.includes(o.value)) return;
        o.disabled = !on;
        o.textContent = (o.value === 'png' ? 'Picture (.png)' : 'Picture, any size (.svg)') + (on ? '' : ' — show a chart first');
    });
    const select = bar.querySelector('select');
    if (!on && PICTURE_FORMATS.includes(select.value)) select.value = 'xlsx';
    const note = bar.querySelector('[data-picture-note]');
    if (note) note.textContent = on ? 'PDF, Word, Excel, RTF and archives include the chart.' : '';
}

// "one-touch-how-many-open-incidents-2026-10-22", like the server's file names
function pictureFileName(payload) {
    const slug = String(payload.question || payload.title || 'chart').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chart';
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `one-touch-${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
        // The chart on screen, if any: its picture is drawn here, in the browser
        const picture = payload.picture ? payload.picture() : null;
        if (PICTURE_FORMATS.includes(format)) {
            if (!picture) throw new Error('Show the answer as a chart first, then download its picture.');
            status.textContent = `Downloaded ${await downloadPicture(picture, format, pictureFileName(payload))}`;
            return;
        }
        const chart = picture && FORMATS_WITH_PICTURE.includes(format) ? await picturePng(chartPicture(picture)) : null;
        const response = await fetch(`${API_BASE}/api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            // The browser's time zone: the file's "Generated" time and date use it
            body: JSON.stringify({ ...payload, format, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, chart }),
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
    selections.results.clear();
    selections.starred.clear();
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

// Each ticket's parent and the families it is in (relations.mjs ticketLinks),
// in Ticket results and Starred tickets. The third item draws the cell: the
// parent and each family's anchor open that ticket's record, with its related tickets.
const OPENABLE = /^(INC|CHG|RITM|SCTASK|REQ)\d{7}$/;
const LINK_COLUMNS = [
    ['Parent', t => t.parent || '', t => t.parent && OPENABLE.test(t.parent)
        ? `<button type="button" class="ticket-link" data-ticket="${escapeHtml(t.parent)}" title="Open ${escapeHtml(t.parent)}">${escapeHtml(t.parent)}</button>` : '—'],
    ['Family', t => (t.families || []).map(f => `${f.name} (${f.size} ${f.size === 1 ? 'ticket' : 'tickets'})`).join('; '),
        t => (t.families || []).length ? t.families.map(familyChipHtml).join('') : '—'],
];

// "Parent incident INC1813985 · 6": opens the anchor's record and its related tickets
function familyChipHtml(f) {
    const label = escapeHtml(`${f.name} · ${f.size.toLocaleString()}`);
    const size = `${f.size.toLocaleString()} ${f.size === 1 ? 'ticket' : 'tickets'} in this family`;
    return OPENABLE.test(f.anchor)
        ? `<button type="button" class="family-chip" data-ticket="${escapeHtml(f.anchor)}" title="${size}. Click to open ${escapeHtml(f.anchor)} and see the family">${label}</button>`
        : `<span class="family-chip" title="${size}. The problem record itself isn't in this export">${label}</span>`;
}

// The list columns with Parent and Family after the summary
const withLinks = extra => [...TICKET_COLUMNS.slice(0, 3), ...LINK_COLUMNS, ...TICKET_COLUMNS.slice(3), ...extra];

function formatStarredAt(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Ticket numbers open the ticket; every row has a star. Rows whose number is
// in `highlight` (e.g. the latest answer's tickets) get `highlightClass`.
// select: the list's name ('results', 'starred'): each row gets a checkbox,
// and the header's ticks them all.
function ticketTableHtml(tickets, columns = TICKET_COLUMNS, highlight = new Set(), highlightClass = 'fresh', { select = null, rowClass = null } = {}) {
    const head = (select ? `<th class="select-cell"><input type="checkbox" class="select-all" data-select-list="${select}" aria-label="Select all"></th>` : '') +
        columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('');
    const body = tickets.map((t, i) => {
        const cls = [highlight.has(t.number) ? highlightClass : '', rowClass ? rowClass(t, i) : ''].filter(Boolean).join(' ');
        return (cls ? `<tr class="${cls}">` : '<tr>') +
        (select ? `<td class="select-cell"><input type="checkbox" class="row-select" data-select-list="${select}" value="${escapeHtml(t.number)}" aria-label="Select ${escapeHtml(t.number)}"></td>` : '') +
        columns.map(([label, get, html], i) => {
        if (i === 0) {
            return `<td class="ticket-cell"><button type="button" class="ticket-link" data-ticket="${escapeHtml(t.number)}"` +
                ` title="Open ${escapeHtml(t.number)}">${escapeHtml(t.number)}</button>${starButtonHtml(t.number)}</td>`;
        }
        if (html) return `<td class="${label === 'Family' ? 'family-cell' : 'parent-cell'}">${html(t)}</td>`;
        const text = String(get(t) || '');
        if (label === 'Summary' && text.length > 120) {
            return `<td title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 117))}…</td>`;
        }
        return `<td>${escapeHtml(text || '—')}</td>`;
    }).join('') + '</tr>';
    }).join('');
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
        return `<tr><th>${escapeHtml(columnLabel(member))}</th><td${cls}>${ticketValueHtml(value, formatValue(member, value), t.number)}</td></tr>`;
    }).join('');
    // Its family (parent, children, …) goes above this, once found (showRelated)
    html += '<div class="record-fields"><div class="record-fields-title">Full record</div>';
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
    return html + '</div>';
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
        const columns = withLinks(SHOWN_COLUMNS);
        const fresh = tickets.filter(t => latestShown.has(t.number)).length;
        return '<div class="results-head">' +
            `<p class="home-status">${tickets.length.toLocaleString()} ${tickets.length === 1 ? 'ticket' : 'tickets'} shown to you, newest first. ` +
            (fresh ? `<span class="fresh-key">Highlighted: the ${fresh.toLocaleString()} from your latest question.</span> ` : '') +
            'Click a ticket number to see its full record, or its parent or family to see those.</p>' +
            `<button type="button" class="home-action danger" onclick="clearTicketResults(${tickets.length})">🧹 Clear ticket results</button></div>` +
            starAllHtml(tickets.map(t => t.number)) + selectBarHtml('results') +
            ticketTableHtml(tickets, columns, latestShown, 'fresh', { select: 'results' }) + ticketDownloadHtml(tickets, 'Ticket results', columns);
    }, quiet).then(() => paintSelection('results'));
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
    // Its parent / child tickets and other linked ones, above its fields
    const out = document.getElementById('ticket-results');
    if (openedRecord === number && out.querySelector('.ticket-head')) showRelated(out, [number], false, out.querySelector('.record-fields'));
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
    const single = focus.size === 1 ? [...focus][0] : null;
    const heading = single ? `👪 ${single}'s family: parent, children and other linked tickets` : '🔗 Related tickets';
    return `<div class="related"><div class="related-title">${escapeHtml(heading)}</div>` + all + families.map(f => {
        const facts = list => list.map(fact => `<span class="fact"><b>${escapeHtml(fact.field)}:</b> ${escapeHtml(familyFact(fact))}</span>`).join('');
        const same = f.same.length
            ? `<div class="family-line"><span class="same-label">Same in all ${f.total.toLocaleString()}</span>${facts(f.same)}</div>` : '';
        const differ = f.differ.length
            ? `<div class="family-line"><span class="differ-label">Different</span>${facts(f.differ)}</div>` : '';
        // The parent (or the order, request, change…) first, then the ticket(s) asked about
        const members = [...f.members].sort((a, b) => ((b.number === f.anchor) - (a.number === f.anchor)) || (focus.has(b.number) - focus.has(a.number)));
        const extra = members.length - FAMILY_MEMBERS_SHOWN;
        const more = extra > 0
            ? `<button type="button" class="home-action family-show-all" data-show-all>Show all ${members.length.toLocaleString()}</button>` : '';
        const where = single ? familyRoleLine(f, single) : '';
        const download = downloadBarHtml(registerExport({ title: f.title, question: about, tables: familyExportTables(f) }), 'Download this family as');
        return `<section class="family${extra > 0 ? ' collapsed' : ''}"><div class="family-title">${escapeHtml(f.title)}</div>` +
            (where ? `<p class="family-where">${escapeHtml(where)}</p>` : '') +
            `<p class="family-why">${escapeHtml(f.why)}</p>${same}${differ}` +
            ticketTableHtml(members, FAMILY_COLUMNS, focus, 'focus', { rowClass: (t, i) => i >= FAMILY_MEMBERS_SHOWN ? 'more-member' : '' }) +
            more + download + '</section>';
    }).join('') + '</div>';
}

// Where one ticket sits in a family: "INC1813970 is a child incident. Its parent is
// INC1813985 (the first row), and it has 4 other child incidents."
function familyRoleLine(f, number) {
    const me = f.members.find(m => m.number === number);
    if (!me) return '';
    const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    const kids = f.members.filter(m => ['Child', 'Child request', 'Task'].includes(m.role)).length;
    switch (f.kind) {
        case 'parent-incident':
            return number === f.anchor
                ? `${number} is the parent incident. Its ${count(kids, 'child incident is', 'child incidents are')} listed under it.`
                : `${number} is a child incident. Its parent is ${f.anchor} (the first row)${kids > 1 ? `, which has ${count(kids - 1, 'other child incident', 'other child incidents')}` : ''}.`;
        case 'bundle-request':
            return number === f.anchor
                ? `${number} is a bundle request. Its ${count(kids, 'child request is', 'child requests are')} listed under it.`
                : `${number} is a child request. Its parent is bundle request ${f.anchor} (the first row)${kids > 1 ? `, which has ${count(kids - 1, 'other child request', 'other child requests')}` : ''}.`;
        case 'request-tasks':
            return number === f.anchor
                ? `${number} is fulfilled by ${count(kids, 'catalog task', 'catalog tasks')}, listed under it.`
                : `${number} is a catalog task of request ${f.anchor} (the first row)${kids > 1 ? `, which has ${count(kids - 1, 'other task', 'other tasks')}` : ''}.`;
        case 'order':
            return `${number} was ordered together with ${count(f.total - 1, 'other request', 'other requests')} in order ${f.anchor}.`;
        case 'problem':
            return `${number} is one of ${count(f.total, 'ticket', 'tickets')} linked to problem ${f.anchor}.`;
        case 'change-incident':
            if (number === f.anchor) return `${number} is the change; the incidents it fixes or caused are listed under it.`;
            return me.role === 'Incident it fixes'
                ? `${number} is the incident that change ${f.anchor} (the first row) was raised to fix.`
                : `${number} was caused by change ${f.anchor} (the first row).`;
        default:
            return '';
    }
}

// Adds "Related tickets" to the end of `container` (an AI answer, or a record on
// Home) once the server has looked; nothing at all if there are none.
// conversation: true also tells the AI about them with the next question.
// before: put it above this element (a record's fields) instead of at the end;
// there, a ticket with no family says so
async function showRelated(container, numbers, conversation, before = null) {
    const slot = document.createElement('div');
    slot.className = 'related-slot';
    slot.innerHTML = `<p class="related-loading">${before ? '👪 Looking for its parent, children and other linked tickets…' : '🔗 Looking for related tickets…'}</p>`;
    if (before) before.before(slot); else container.appendChild(slot);
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
        if (!data.families.length) {
            if (before) slot.innerHTML = '<p class="related-none">👪 No parent, child or other linked tickets.</p>';
            else slot.remove();
            return;
        }
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

// "Clear ticket results": after a confirmation, the whole list goes, on every
// computer. Stars are separate and stay; new answers fill the list again.
async function clearTicketResults(count) {
    const what = `${count.toLocaleString()} ${count === 1 ? 'ticket' : 'tickets'}`;
    if (!confirm(`Clear your ticket results? The list of ${what} is emptied on every computer you use. Your starred tickets stay starred.`)) return;
    try {
        const response = await fetch(`${API_BASE}/api/seen-tickets`, { method: 'DELETE', headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        latestShown = new Set();
        openedRecord = null;
        await showTicketResults();
        showToast('Ticket results cleared');
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
function showStarred(quiet = false) {
    return runHomeSearch('starred', 'starred-result', async () => {
        const response = await fetch(`${API_BASE}/api/stars?details=1`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        starredTickets.clear();
        for (const s of data.stars) starredTickets.set(s.number, s.starredAt);
        refreshStarButtons();
        const numbers = data.stars.map(s => s.number);
        if (!numbers.length) {
            return '<p class="home-status">No starred tickets yet. Click ☆ next to any ticket number: in your ticket results, ' +
                'in the AI assistant\'s answers, or on an incident, change or request record in Dashboards. ' +
                'Your stars are saved to your account, so they are here on any computer you sign in from.</p>';
        }
        const columns = withLinks([STARRED_COLUMN]);
        const missing = data.notFound.length
            ? `<p class="home-status">Not in the data any more: ${escapeHtml(data.notFound.join(', '))}</p>` : '';
        return '<div class="results-head">' +
            `<p class="home-status">${numbers.length.toLocaleString()} starred ${numbers.length === 1 ? 'ticket' : 'tickets'}, newest first. ` +
            'Tick tickets to unstar several at once.</p>' +
            `<button type="button" class="home-action danger" onclick="unstarAll()">☆ Unstar all</button></div>` +
            unstarByIssueHtml(data.tickets) + selectBarHtml('starred') +
            ticketTableHtml(data.tickets, columns, new Set(), 'fresh', { select: 'starred' }) + missing + ticketDownloadHtml(data.tickets, 'Starred tickets', columns);
    }, quiet).then(() => paintSelection('starred'));
}

// "Unstar by issue": starred tickets that share a family (the same parent
// incident, problem, change, order, bundle or request), one button per family
function unstarByIssueHtml(tickets) {
    const groups = new Map();
    for (const t of tickets) {
        for (const f of t.families || []) {
            if (!groups.has(f.key)) groups.set(f.key, { name: f.name, numbers: [] });
            groups.get(f.key).numbers.push(t.number);
        }
    }
    const shared = [...groups.values()].filter(g => g.numbers.length >= 2).sort((a, b) => b.numbers.length - a.numbers.length);
    if (!shared.length) return '';
    const shown = shared.slice(0, 10);
    // The numbers are ticket numbers (from the server's list), so they need no escaping
    return '<div class="issue-bar"><span class="issue-label">Unstar by issue:</span>' +
        shown.map(g => `<button type="button" class="issue-unstar" data-unstar-many="${g.numbers.join(',')}" data-what="${escapeHtml(g.name)}">` +
            `☆ Unstar the ${g.numbers.length} in ${escapeHtml(g.name)}</button>`).join('') +
        (shared.length > shown.length ? `<span class="issue-more">and ${(shared.length - shown.length).toLocaleString()} more issues</span>` : '') + '</div>';
}

// ---------------------------------------------------------------------
// Selecting tickets in Ticket results or Starred tickets: tick rows (Shift
// ticks a range, the header's checkbox ticks all), then remove them from
// the list or unstar them, in one go
// ---------------------------------------------------------------------

const selections = { results: new Set(), starred: new Set() };
const lastTicked = { results: null, starred: null };
const LIST_BOXES = { results: 'ticket-results', starred: 'starred-result' };

// The bar over a list: what's ticked, then 💬 ask the AI about them, the list's own
// action (remove / unstar), unstar and remove, and clear the ticks
function selectBarHtml(list) {
    return `<div class="select-bar" data-select-bar="${list}"><span class="select-count" aria-live="polite"></span>` +
        `<button type="button" class="home-action" data-ask-open="${list}" aria-expanded="false" disabled></button>` +
        `<button type="button" class="home-action danger" data-selected-action="${list}" disabled></button>` +
        `<button type="button" class="home-action danger" data-selected-both="${list}" disabled title="Unstar the ticked tickets and remove them from Ticket results"></button>` +
        `<button type="button" class="home-action" data-select-none="${list}" disabled>Clear selection</button></div>` +
        askBoxHtml(list);
}

// 💬 A question about the ticked tickets, asked in the chat with their numbers
const ASK_SUGGESTIONS = [
    'What do these tickets have in common?',
    'Which of these are still open?',
    'Who is working on these, and in which teams?',
    'Show me the full details of these tickets',
];
const MAX_ASK_TICKETS = 100;

function askBoxHtml(list) {
    return `<div class="ask-selected" data-ask-box="${list}" hidden>` +
        `<div class="ask-selected-row"><input type="text" class="ask-selected-input" data-ask-input="${list}" maxlength="300"` +
        ` placeholder="Ask anything about the ticked tickets…" aria-label="Your question about the ticked tickets">` +
        `<button type="button" class="primary-btn" data-ask-go="${list}">Ask</button></div>` +
        `<div class="ask-suggestions">${ASK_SUGGESTIONS.map(q => `<button type="button" class="ask-chip" data-ask-suggest="${list}" data-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div></div>`;
}

// The ticked tickets, in the list's order
function tickedInOrder(list) {
    return [...document.getElementById(LIST_BOXES[list]).querySelectorAll('.row-select:checked')].map(b => b.value);
}

function askAboutTicked(list, question) {
    const numbers = tickedInOrder(list);
    question = String(question || '').trim();
    if (!numbers.length || !question) return;
    if (numbers.length > MAX_ASK_TICKETS) {
        showToast(`Ask about up to ${MAX_ASK_TICKETS} tickets at a time; ${numbers.length.toLocaleString()} are ticked.`);
        return;
    }
    askAssistant(`About ${numbers.length === 1 ? 'ticket' : 'tickets'} ${numbers.join(', ')}: ${question}`);
}

// The ticks, the header checkbox and the bar, from the list's selection
function paintSelection(list) {
    const out = document.getElementById(LIST_BOXES[list]);
    const boxes = [...out.querySelectorAll('.row-select')];
    const present = new Set(boxes.map(b => b.value));
    for (const n of [...selections[list]]) if (!present.has(n)) selections[list].delete(n);
    for (const box of boxes) {
        box.checked = selections[list].has(box.value);
        box.closest('tr').classList.toggle('selected', box.checked);
    }
    const n = selections[list].size;
    const all = out.querySelector('.select-all');
    if (all) {
        all.checked = n > 0 && n === boxes.length;
        all.indeterminate = n > 0 && n < boxes.length;
    }
    const bar = out.querySelector('.select-bar');
    if (!bar) return;
    bar.querySelector('.select-count').textContent = n ? `${n.toLocaleString()} selected`
        : list === 'results' ? 'Tick tickets to remove them from this list.' : 'Tick tickets to unstar them together.';
    const count = n ? ` ${n.toLocaleString()}` : '';
    const action = bar.querySelector('[data-selected-action]');
    action.disabled = !n;
    action.textContent = list === 'results' ? `✕ Remove${count} from Ticket results` : (n ? `☆ Unstar${count}` : '☆ Unstar selected');
    const both = bar.querySelector('[data-selected-both]');
    both.disabled = !n;
    both.textContent = `☆ Unstar and ✕ remove${count} from Ticket results`;
    const ask = bar.querySelector('[data-ask-open]');
    ask.disabled = !n;
    ask.textContent = n ? `💬 Ask the AI about${count}` : '💬 Ask the AI about them';
    if (!n) {
        out.querySelector('.ask-selected').hidden = true;
        ask.setAttribute('aria-expanded', 'false');
    }
    bar.querySelector('[data-select-none]').disabled = !n;
}

document.addEventListener('click', e => {
    const box = e.target.closest?.('.row-select, .select-all');
    if (box) {
        const list = box.dataset.selectList;
        const boxes = [...document.getElementById(LIST_BOXES[list]).querySelectorAll('.row-select')];
        if (box.classList.contains('select-all')) {
            for (const b of boxes) box.checked ? selections[list].add(b.value) : selections[list].delete(b.value);
        } else {
            // Shift: every row between the last one ticked and this one takes this one's tick
            const i = boxes.indexOf(box);
            const from = e.shiftKey && lastTicked[list] !== null ? Math.min(lastTicked[list], i) : i;
            const to = e.shiftKey && lastTicked[list] !== null ? Math.max(lastTicked[list], i) : i;
            for (const b of boxes.slice(from, to + 1)) box.checked ? selections[list].add(b.value) : selections[list].delete(b.value);
            lastTicked[list] = i;
        }
        paintSelection(list);
        return;
    }
    const none = e.target.closest?.('[data-select-none]');
    if (none) {
        selections[none.dataset.selectNone].clear();
        paintSelection(none.dataset.selectNone);
        return;
    }
    const both = e.target.closest?.('[data-selected-both]');
    if (both) {
        unstarAndRemove(tickedInOrder(both.dataset.selectedBoth));
        return;
    }
    const askOpen = e.target.closest?.('[data-ask-open]');
    if (askOpen) {
        const box = document.querySelector(`[data-ask-box="${askOpen.dataset.askOpen}"]`);
        box.hidden = !box.hidden;
        askOpen.setAttribute('aria-expanded', String(!box.hidden));
        if (!box.hidden) box.querySelector('input').focus();
        return;
    }
    const askGo = e.target.closest?.('[data-ask-go]');
    if (askGo) {
        askAboutTicked(askGo.dataset.askGo, document.querySelector(`[data-ask-input="${askGo.dataset.askGo}"]`).value);
        return;
    }
    const suggestion = e.target.closest?.('[data-ask-suggest]');
    if (suggestion) {
        askAboutTicked(suggestion.dataset.askSuggest, suggestion.dataset.question);
        return;
    }
    const act = e.target.closest?.('[data-selected-action]');
    if (act) {
        const list = act.dataset.selectedAction;
        const numbers = [...selections[list]];
        if (list === 'results') removeFromResults(numbers);
        else unstarMany(numbers, `${numbers.length.toLocaleString()} ${numbers.length === 1 ? 'ticket' : 'tickets'}`);
        return;
    }
    const issue = e.target.closest?.('[data-unstar-many]');
    if (issue) {
        const numbers = issue.dataset.unstarMany.split(',');
        unstarMany(numbers, `the ${numbers.length} in ${issue.dataset.what}`);
    }
});

// Enter in the question box asks
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches?.('[data-ask-input]')) {
        e.preventDefault();
        askAboutTicked(e.target.dataset.askInput, e.target.value);
    }
});

// The ticked tickets leave Ticket results (on every computer); their stars stay.
// quiet: no list refresh or note (unstarAndRemove does both itself). -> true when done
async function removeFromResults(numbers, { quiet = false } = {}) {
    if (!numbers.length) return false;
    const total = document.querySelectorAll('#ticket-results .row-select').length;
    if (!quiet && numbers.length === total && !confirm(`Remove all ${total.toLocaleString()} tickets from your ticket results? Your starred tickets stay starred.`)) return false;
    try {
        const response = await fetch(`${API_BASE}/api/seen-tickets/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        for (const n of numbers) {
            selections.results.delete(n);
            latestShown.delete(n);
        }
        if (quiet) return true;
        await showTicketResults(true);
        showToast(`Removed ${numbers.length.toLocaleString()} ${numbers.length === 1 ? 'ticket' : 'tickets'} from Ticket results`);
        return true;
    } catch (err) {
        showToast(`❌ ${err.message}`);
        return false;
    }
}

// "Unstar and remove from Ticket results": both, for the ticked tickets, after asking
async function unstarAndRemove(numbers) {
    if (!numbers.length) return;
    const what = `${numbers.length.toLocaleString()} ${numbers.length === 1 ? 'ticket' : 'tickets'}`;
    if (!confirm(`Unstar ${what} and remove ${numbers.length === 1 ? 'it' : 'them'} from your Ticket results?`)) return;
    const unstarred = numbers.some(n => starredTickets.has(n)) ? await unstarMany(numbers, what, { quiet: true }) : true;
    const removed = await removeFromResults(numbers, { quiet: true });
    for (const n of numbers) selections.starred.delete(n);
    if (homeMode === 'starred') await showStarred(true); else await showTicketResults(true);
    if (unstarred && removed) showToast(`☆ Unstarred ${what} and removed ${numbers.length === 1 ? 'it' : 'them'} from Ticket results`);
}

// Unstars many in one request; the screen changes at once, and back if the server says no.
// quiet: no list refresh or note. -> true when done
async function unstarMany(numbers, what, { quiet = false } = {}) {
    const toRemove = numbers.filter(n => starredTickets.has(n));
    if (!toRemove.length) return true;
    const before = new Map(toRemove.map(n => [n, starredTickets.get(n)]));
    for (const n of toRemove) starredTickets.delete(n);
    refreshStarButtons();
    try {
        const response = await fetch(`${API_BASE}/api/stars/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers: toRemove }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        for (const n of toRemove) selections.starred.delete(n);
        if (quiet) return true;
        if (homeMode === 'starred') await showStarred(true);
        showToast(`☆ Unstarred ${what}`);
        return true;
    } catch (err) {
        for (const [n, at] of before) starredTickets.set(n, at);
        refreshStarButtons();
        showToast(`❌ ${err.message}`);
        return false;
    }
}

function unstarAll() {
    const count = starredTickets.size;
    if (!count || !confirm(`Unstar all ${count.toLocaleString()} starred ${count === 1 ? 'ticket' : 'tickets'}? This can't be undone.`)) return;
    unstarMany([...starredTickets.keys()], `all ${count.toLocaleString()} ${count === 1 ? 'ticket' : 'tickets'}`);
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

    const showAll = e.target.closest('[data-show-all]');
    if (showAll) {
        showAll.closest('.family').classList.remove('collapsed');
        showAll.remove();
        return;
    }

    const view = e.target.closest('[data-answer-view]');
    if (view) { setAnswerView(view.closest('.msg'), view.dataset.answerView); return; }
    const saveChart = e.target.closest('[data-answer-save]');
    if (saveChart) { saveAnswerChart(saveChart.closest('.msg')); return; }

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
        showRelated(box, [number], false, box.querySelector('.record-fields'));
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
buildThemePanel();
buildBuilder();
buildBoardFilters();
renderHomeLayout();
renderMyDashboards();
readSignInLink();
showApp(Boolean(sessionTokenValue));
loadCurrentUser();

// A reload empties the chat on screen and starts a fresh one; the one
// before it is under "Earlier chats"
resetConversation();
