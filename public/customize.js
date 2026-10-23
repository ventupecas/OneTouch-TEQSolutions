// =====================================================================
// CUSTOMIZING: each person's color scheme, their Home page (which
// sections show, in what order, and charts of their own) and their own
// dashboards (the data each chart shows and how it's shown). Everything is
// saved to their account (prefs.mjs on the server), so it is the same after
// a refresh, signing out, a server restart, and on any computer.
// Loaded before app.js, whose helpers these functions use when they run.
// =====================================================================

// ---------------------------------------------------------------------
// Saved preferences: loaded at sign-in, each part saved as it changes
// ---------------------------------------------------------------------

const THEME_DEFAULTS = { mode: 'light', accent: '#10a37f', header: 'dark' };
const defaultHome = () => ({ blocks: [{ type: 'assistant' }, { type: 'tickets' }] });
const defaultDashboards = () => ({ boards: [], hidden: [], last: '' });

const prefs = { theme: { ...THEME_DEFAULTS }, home: defaultHome(), dashboards: defaultDashboards() };
let prefsReady = Promise.resolve();
// When loading failed, saving is off: it would replace what's saved with the defaults
let prefsLoadFailed = false;

const PART_NAMES = { theme: 'colors', home: 'Home page', dashboards: 'dashboards' };

function loadPreferences() {
    const token = sessionTokenValue;
    prefsLoadFailed = false;
    // Home waits for this person's layout, but never for long
    const reveal = setTimeout(() => document.getElementById('home-blocks').classList.remove('waiting'), 3000);
    prefsReady = (async () => {
        try {
            const response = await fetch(`${API_BASE}/api/preferences`, { headers: authHeaders() });
            if (handleUnauthorized(response)) return;
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
            if (token !== sessionTokenValue) return; // signed out meanwhile
            const saved = data.preferences || {};
            prefs.theme = { ...THEME_DEFAULTS, ...saved.theme };
            prefs.home = Array.isArray(saved.home?.blocks) ? saved.home : defaultHome();
            prefs.dashboards = { ...defaultDashboards(), ...saved.dashboards };
        } catch (err) {
            prefsLoadFailed = true;
            console.error('Could not load the saved layout and colors:', err);
            showToast(`❌ ${err.message} Showing the defaults; refresh the page to try again.`);
        }
        applyTheme(prefs.theme);
        rememberTheme();
        paintThemePanel();
        renderHomeLayout();
        renderMyDashboards();
        clearTimeout(reveal);
        document.getElementById('home-blocks').classList.remove('waiting');
    })();
    return prefsReady;
}

// One save at a time per part; changes made meanwhile go in one more save
const prefSaves = {};
function savePreference(part) {
    if (prefsLoadFailed) {
        showToast(`Your ${PART_NAMES[part]} can't be saved because your settings didn't load. Refresh the page to try again.`);
        return Promise.resolve(false);
    }
    const state = prefSaves[part] || (prefSaves[part] = { running: null, again: false });
    if (state.running) {
        state.again = true;
        return state.running;
    }
    const token = sessionTokenValue;
    state.running = (async () => {
        do {
            state.again = false;
            if (!token || token !== sessionTokenValue) return false;
            try {
                const response = await fetch(`${API_BASE}/api/preferences/${part}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ value: prefs[part] }),
                });
                if (handleUnauthorized(response)) return false;
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
            } catch (err) {
                showToast(`❌ Your ${PART_NAMES[part]} could not be saved: ${err.message}`);
                return false;
            }
        } while (state.again);
        return true;
    })().finally(() => { state.running = null; });
    return state.running;
}

// For changes that come in a stream (dragging the custom color)
const saveTimers = {};
function savePreferenceSoon(part, delay = 500) {
    clearTimeout(saveTimers[part]);
    saveTimers[part] = setTimeout(() => savePreference(part), delay);
}

const newChartId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// A chart with every setting filled in (the server checks them again)
function chartWithDefaults(c) {
    return {
        id: newChartId(), title: '', status: 'all', dates: { preset: 'all' }, filters: [], groupBy: '',
        display: c.groupBy ? 'bar' : 'number', limit: 10, sort: 'count', size: 'medium', color: 'accent', ...c,
    };
}

// Signing out leaves nothing of this person's on the page
function resetCustomizing() {
    Object.values(saveTimers).forEach(clearTimeout);
    for (const state of Object.values(prefSaves)) state.again = false;
    prefs.theme = { ...THEME_DEFAULTS };
    prefs.home = defaultHome();
    prefs.dashboards = defaultDashboards();
    prefsReady = Promise.resolve();
    prefsLoadFailed = false;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close('cancel');
    applyTheme(prefs.theme);
    try { localStorage.removeItem(THEME_CACHE_KEY); } catch { /* nothing kept */ }
    toggleThemePanel(false);
    toggleHomeEditing(false);
    toggleDrawerEditing(false);
    hideBoard();
    renderHomeLayout();
    renderMyDashboards();
    document.getElementById('home-blocks').classList.add('waiting');
    dashboardsLoading = null; // the next person's dashboards open where they left them
}

// ---------------------------------------------------------------------
// COLOR SCHEME: light, dark or the computer's setting; an accent color
// (buttons, the lit page button, charts); and the header's color
// ---------------------------------------------------------------------

const ACCENT_CHOICES = [
    ['#10a37f', 'OneTouch green'], ['#2a78d6', 'Blue'], ['#6250d6', 'Violet'], ['#d55181', 'Pink'],
    ['#e34948', 'Red'], ['#eb6834', 'Orange'], ['#0f8a8a', 'Teal'], ['#4a5568', 'Slate'],
];
const THEME_MODES = [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', '💻 Match my computer']];
const HEADER_STYLES = [['dark', 'Dark'], ['accent', 'Accent color'], ['light', 'Same as the page']];
// This browser's copy of the last scheme, so a reload doesn't flash the
// default colors before the account's arrive (read by index.html's head)
const THEME_CACHE_KEY = 'onetouch-theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// White text on the accent when it reads well enough (3:1, like the default
// green), otherwise near-black: a pale custom color still has readable buttons
function readableOn(hex) {
    const channel = i => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return 1.05 / (luminance + 0.05) >= 3 ? '#ffffff' : '#1a202c';
}

function applyTheme(theme) {
    const t = { ...THEME_DEFAULTS, ...theme };
    const root = document.documentElement;
    const wasDark = root.dataset.theme === 'dark';
    const dark = t.mode === 'dark' || (t.mode === 'system' && systemDark.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.header = t.header;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--on-accent', readableOn(t.accent));
    // The Metabase dashboards have their own light and dark looks
    if (wasDark !== dark) refreshDashboardTheme();
}
systemDark.addEventListener('change', () => applyTheme(prefs.theme));

function rememberTheme() {
    try {
        localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ ...prefs.theme, onAccent: readableOn(prefs.theme.accent) }));
    } catch { /* the default colors show briefly on a reload; that's fine */ }
}

function setTheme(change, gradual = false) {
    prefs.theme = { ...prefs.theme, ...change };
    applyTheme(prefs.theme);
    rememberTheme();
    paintThemePanel();
    if (gradual) savePreferenceSoon('theme');
    else savePreference('theme');
}

function resetTheme() {
    setTheme({ ...THEME_DEFAULTS });
    showToast('Colors are back to the default');
}

// The 🎨 Colors panel under the header
function buildThemePanel() {
    const radios = (name, choices) => choices.map(([value, label]) =>
        `<label class="choice-pill"><input type="radio" name="${name}" value="${value}"><span>${escapeHtml(label)}</span></label>`).join('');
    document.getElementById('theme-modes').innerHTML = radios('theme-mode', THEME_MODES);
    document.getElementById('theme-headers').innerHTML = radios('theme-header', HEADER_STYLES);
    document.getElementById('theme-accents').innerHTML = ACCENT_CHOICES.map(([hex, name]) =>
        `<label class="swatch" title="${escapeHtml(name)}"><input type="radio" name="theme-accent" value="${hex}" aria-label="${escapeHtml(name)}">` +
        `<span style="background:${hex}"></span></label>`).join('');
    const panel = document.getElementById('theme-panel');
    panel.addEventListener('change', e => {
        if (e.target.name === 'theme-mode') setTheme({ mode: e.target.value });
        if (e.target.name === 'theme-header') setTheme({ header: e.target.value });
        if (e.target.name === 'theme-accent') setTheme({ accent: e.target.value });
    });
    document.getElementById('theme-custom').addEventListener('input', e => setTheme({ accent: e.target.value.toLowerCase() }, true));
    paintThemePanel();
}

function paintThemePanel() {
    const t = prefs.theme;
    document.querySelectorAll('#theme-panel input[name="theme-mode"]').forEach(r => { r.checked = r.value === t.mode; });
    document.querySelectorAll('#theme-panel input[name="theme-header"]').forEach(r => { r.checked = r.value === t.header; });
    document.querySelectorAll('#theme-panel input[name="theme-accent"]').forEach(r => { r.checked = r.value === t.accent; });
    const custom = document.getElementById('theme-custom');
    if (custom && document.activeElement !== custom) custom.value = t.accent;
    const isPreset = ACCENT_CHOICES.some(([hex]) => hex === t.accent);
    custom?.closest('.swatch-custom')?.classList.toggle('on', !isPreset);
}

function toggleThemePanel(open) {
    const panel = document.getElementById('theme-panel');
    const button = document.getElementById('theme-btn');
    const willOpen = typeof open === 'boolean' ? open : panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) panel.querySelector('input:checked, input')?.focus();
    else if (panel.contains(document.activeElement)) button.focus();
}

// A click outside the panel closes it
document.addEventListener('pointerdown', e => {
    const panel = document.getElementById('theme-panel');
    if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#theme-btn')) toggleThemePanel(false);
});

// ---------------------------------------------------------------------
// A small "name it" box (new dashboard, rename)
// ---------------------------------------------------------------------

function askText({ title, label, value = '', action = 'Save' }) {
    const dialog = document.getElementById('ask-dialog');
    const input = document.getElementById('ask-input');
    dialog.querySelector('.ask-title').textContent = title;
    dialog.querySelector('.ask-label').textContent = label;
    document.getElementById('ask-ok').textContent = action;
    input.value = value;
    dialog.returnValue = '';
    dialog.showModal();
    input.select();
    return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value.replace(/\s+/g, ' ').trim() : null), { once: true });
    });
}

// ---------------------------------------------------------------------
// CHART TILES: one chart, its title, what it counts, and its buttons
// ---------------------------------------------------------------------

const TILE_BUTTONS = {
    table: ['▦', 'Show as a table'],
    edit: ['✎', 'Edit this chart'],
    earlier: ['◀', 'Move earlier'],
    later: ['▶', 'Move later'],
    pin: ['📌', 'Add a copy to Home'],
    remove: ['🗑', 'Remove this chart'],
};
const HOME_TILE_BUTTONS = ['table', 'edit', 'earlier', 'later', 'remove'];
const BOARD_TILE_BUTTONS = ['table', 'edit', 'earlier', 'later', 'pin', 'remove'];

function tileHtml(chart, buttons, extraClass = '') {
    const actions = buttons.map(a => `<button type="button" class="tile-btn" data-tile-action="${a}" title="${TILE_BUTTONS[a][1]}" aria-label="${TILE_BUTTONS[a][1]}">${TILE_BUTTONS[a][0]}</button>`).join('');
    return `<article class="chart-tile size-${chart.size} ${extraClass}" data-chart-id="${escapeHtml(chart.id)}">` +
        `<div class="tile-head"><div class="tile-titles"><h3 class="tile-title"></h3><p class="tile-sub"></p></div>` +
        (actions ? `<div class="tile-actions">${actions}</div>` : '') + `</div>` +
        `<div class="tile-body"><p class="chart-loading">Loading…</p></div><p class="chart-note" hidden></p></article>`;
}

// Fetches (or reuses) the chart's numbers and draws it. While new numbers
// load, the old drawing stays, dimmed, instead of jumping to "Loading…".
async function fillTile(tile, chart, asTable = tile._asTable || false) {
    const body = tile.querySelector('.tile-body');
    const run = (body._run || 0) + 1;
    body._run = run;
    tile._asTable = asTable;
    if (body._drawn) body.classList.add('refreshing');
    try {
        await loadChartCatalog();
        if (body._run !== run) return;
        tile.querySelector('.tile-title').textContent = chartTitle(chart);
        tile.querySelector('.tile-sub').textContent = chartDescription(chart);
        const data = await fetchChartData(chart);
        if (!data || body._run !== run || !tile.isConnected) return;
        drawChart(body, chart, data, asTable);
        const note = tile.querySelector('.chart-note');
        note.textContent = asTable ? '' : chartNote(chart, data);
        note.hidden = !note.textContent;
        const tableButton = tile.querySelector('[data-tile-action="table"]');
        if (tableButton) {
            tableButton.hidden = chart.display === 'table' || chart.display === 'number' || !chart.groupBy;
            tableButton.setAttribute('aria-pressed', String(asTable));
            tableButton.title = asTable ? 'Show the chart' : 'Show as a table';
            tableButton.setAttribute('aria-label', tableButton.title);
        }
    } catch (err) {
        if (body._run !== run) return;
        body._drawn = null;
        body.innerHTML = `<p class="chart-empty error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    } finally {
        if (body._run === run) body.classList.remove('refreshing');
    }
}

// The list a tile belongs to: Home's sections, or the open dashboard's charts
function tilePlace(tile) {
    if (tile.closest('#home-blocks')) {
        const list = prefs.home.blocks;
        return { where: 'home', list, index: list.findIndex(b => b.chart?.id === tile.dataset.chartId), chartOf: b => b.chart };
    }
    const board = currentBoard();
    const list = board ? board.charts : [];
    return { where: 'board', list, index: list.findIndex(c => c.id === tile.dataset.chartId), chartOf: c => c };
}

function savePlace(where) {
    if (where === 'home') {
        renderHomeLayout();
        savePreference('home');
    } else {
        renderBoard();
        renderMyDashboards();
        savePreference('dashboards');
    }
}

function tileAction(tile, action) {
    const { where, list, index, chartOf } = tilePlace(tile);
    if (index < 0) return;
    const chart = chartOf(list[index]);
    if (action === 'table') {
        fillTile(tile, chart, !tile._asTable);
    } else if (action === 'edit') {
        openBuilder({
            chart,
            onSave: updated => {
                if (where === 'home') list[index] = { type: 'chart', chart: updated };
                else list[index] = updated;
                savePlace(where);
            },
        });
    } else if (action === 'earlier' || action === 'later') {
        const to = index + (action === 'earlier' ? -1 : 1);
        if (to < 0 || to >= list.length) return;
        [list[index], list[to]] = [list[to], list[index]];
        savePlace(where);
        // Keep the keyboard on the chart that moved
        document.querySelector(`.chart-tile[data-chart-id="${CSS.escape(chart.id)}"] [data-tile-action="${action}"]`)?.focus();
    } else if (action === 'pin') {
        prefs.home.blocks.push({ type: 'chart', chart: { ...structuredClone(chart), id: newChartId() } });
        renderHomeLayout();
        savePreference('home');
        showToast(`📌 "${chartTitle(chart)}" is now on your Home page too`);
    } else if (action === 'remove') {
        if (!confirm(`Remove the chart "${chartTitle(chart)}"?`)) return;
        list.splice(index, 1);
        savePlace(where);
        showToast('Chart removed');
    }
}

document.addEventListener('click', e => {
    const button = e.target.closest('[data-tile-action]');
    if (button) tileAction(button.closest('.chart-tile'), button.dataset.tileAction);
});

// ---------------------------------------------------------------------
// HOME LAYOUT: the AI assistant, your tickets, dashboard shortcuts and
// your own charts, in the order you choose; "Customize Home" edits it
// ---------------------------------------------------------------------

const HOME_SECTIONS = {
    assistant: '💬 AI assistant',
    tickets: '🎫 Your tickets',
    shortcuts: '📊 Your dashboards',
};

function renderHomeLayout() {
    const container = document.getElementById('home-blocks');
    const sections = new Map([...container.querySelectorAll(':scope > [data-block]')].map(el => [el.dataset.block, el]));
    container.querySelectorAll(':scope > .chart-tile').forEach(tile => tile.remove());
    const blocks = prefs.home.blocks;
    blocks.forEach((block, i) => {
        let el;
        if (block.type === 'chart') {
            container.insertAdjacentHTML('beforeend', tileHtml(block.chart, HOME_TILE_BUTTONS, 'home-block'));
            el = container.lastElementChild;
            fillTile(el, block.chart);
        } else {
            el = sections.get(block.type);
            if (!el) return;
            el.hidden = false;
            container.appendChild(el);
            addSectionBar(el);
            el.querySelector('[data-block-action="up"]').disabled = i === 0;
            el.querySelector('[data-block-action="down"]').disabled = i === blocks.length - 1;
        }
    });
    for (const [type, el] of sections) {
        if (!blocks.some(b => b.type === type)) el.hidden = true;
    }
    // Hidden sections can be added back while customizing
    const missing = Object.keys(HOME_SECTIONS).filter(type => !blocks.some(b => b.type === type));
    document.getElementById('home-add-back').innerHTML = missing.map(type =>
        `<button type="button" class="home-action" data-add-section="${type}">＋ ${escapeHtml(HOME_SECTIONS[type])}</button>`).join('');
    const empty = document.getElementById('home-empty');
    empty.hidden = blocks.length > 0;
    renderShortcuts();
}

// Each section's bar while customizing: its name, move up / down, hide
function addSectionBar(section) {
    if (section.querySelector(':scope > .block-bar')) return;
    section.insertAdjacentHTML('afterbegin', `<div class="block-bar"><span class="block-name">${escapeHtml(HOME_SECTIONS[section.dataset.block])}</span>` +
        '<button type="button" class="home-action" data-block-action="up">▲ Move up</button>' +
        '<button type="button" class="home-action" data-block-action="down">▼ Move down</button>' +
        '<button type="button" class="home-action" data-block-action="hide">Hide</button></div>');
}

function toggleHomeEditing(on) {
    const home = document.getElementById('home');
    const editing = typeof on === 'boolean' ? on : !home.classList.contains('editing');
    home.classList.toggle('editing', editing);
    document.getElementById('home-edit-bar').hidden = !editing;
    const button = document.getElementById('customize-home-btn');
    button.setAttribute('aria-pressed', String(editing));
    button.textContent = editing ? '✓ Done' : '✏️ Customize Home';
}

function addHomeChart() {
    openBuilder({
        onSave: chart => {
            prefs.home.blocks.push({ type: 'chart', chart });
            renderHomeLayout();
            savePreference('home');
            document.querySelector(`#home-blocks .chart-tile[data-chart-id="${CSS.escape(chart.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        },
    });
}

function resetHomeLayout() {
    if (!confirm('Reset Home? The sections go back to the default order, and the charts you added to Home are removed. Your dashboards are not affected.')) return;
    prefs.home = defaultHome();
    renderHomeLayout();
    savePreference('home');
    showToast('Home is back to the default');
}

document.addEventListener('click', e => {
    const action = e.target.closest('[data-block-action]');
    if (action) {
        const type = action.closest('[data-block]').dataset.block;
        const blocks = prefs.home.blocks;
        const index = blocks.findIndex(b => b.type === type);
        if (index < 0) return;
        const what = action.dataset.blockAction;
        if (what === 'hide') {
            blocks.splice(index, 1);
            showToast(`${HOME_SECTIONS[type]} is hidden. Add it back from Customize Home.`);
        } else {
            const to = index + (what === 'up' ? -1 : 1);
            if (to < 0 || to >= blocks.length) return;
            [blocks[index], blocks[to]] = [blocks[to], blocks[index]];
        }
        renderHomeLayout();
        savePreference('home');
        if (what !== 'hide') document.querySelector(`[data-block="${type}"] [data-block-action="${what}"]:not(:disabled)`)?.focus();
        return;
    }
    const add = e.target.closest('[data-add-section]');
    if (add) {
        prefs.home.blocks.push({ type: add.dataset.addSection });
        renderHomeLayout();
        savePreference('home');
    }
});

// The "Your dashboards" section: one button per dashboard of your own
function renderShortcuts() {
    const list = document.getElementById('home-shortcuts');
    const boards = prefs.dashboards.boards;
    list.innerHTML = boards.map(b => `<button type="button" class="shortcut" data-open-board="${escapeHtml(b.id)}">` +
        `<span class="shortcut-name">${escapeHtml(b.name)}</span><span class="shortcut-desc">${chartCount(b.charts.length)}</span></button>`).join('') +
        '<button type="button" class="shortcut new" onclick="newBoard()"><span class="shortcut-name">＋ New dashboard</span><span class="shortcut-desc">Pick the data and how it\'s shown</span></button>' +
        '<button type="button" class="shortcut" onclick="switchTab(\'dashboard\')"><span class="shortcut-name">📈 Team dashboards</span><span class="shortcut-desc">The shared Metabase dashboards</span></button>';
}

const chartCount = n => `${n} ${n === 1 ? 'chart' : 'charts'}`;

// ---------------------------------------------------------------------
// MY DASHBOARDS: dashboards each person builds from their own charts,
// listed at the top of the Dashboards drawer
// ---------------------------------------------------------------------

let currentBoardId = null;

function currentBoard() {
    return prefs.dashboards.boards.find(b => b.id === currentBoardId) || null;
}

// The drawer's "My dashboards" list (and Home's shortcuts)
function renderMyDashboards() {
    const list = document.getElementById('my-dashboards-list');
    const boards = prefs.dashboards.boards;
    list.innerHTML = boards.length
        ? boards.map(b => `<button type="button" class="dashboard-choice${b.id === currentBoardId ? ' active' : ''}" data-board="${escapeHtml(b.id)}"${b.id === currentBoardId ? ' aria-current="page"' : ''}>` +
            `<span class="dashboard-choice-name">${escapeHtml(b.name)}</span><span class="dashboard-choice-desc">${chartCount(b.charts.length)}</span></button>`).join('')
        : '<p class="drawer-note">Build a dashboard of your own: choose the data each chart shows and how it\'s drawn.</p>';
    renderShortcuts();
}

function showBoard(id) {
    const board = prefs.dashboards.boards.find(b => b.id === id);
    if (!board) return false;
    currentBoardId = id;
    document.getElementById('dashboard-frame').hidden = true;
    document.getElementById('dashboard-message').hidden = true;
    document.getElementById('dashboard-star').hidden = true;
    document.getElementById('board-view').hidden = false;
    document.querySelectorAll('.dashboard-choice').forEach(b => {
        const on = b.dataset.board === id;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    rememberDashboard(`my:${id}`);
    renderBoard();
    return true;
}

// Back to the team dashboards' frame
function hideBoard() {
    currentBoardId = null;
    document.getElementById('board-view').hidden = true;
    document.querySelectorAll('.dashboard-choice[data-board]').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
}

// From Home's shortcuts
async function openBoard(id) {
    toggleAssistant(false);
    switchTab('dashboard');
    await loadDashboards();
    showBoard(id);
}

function renderBoard() {
    const board = currentBoard();
    if (!board) return;
    setDashboardHeading('My dashboards', board.name, chartCount(board.charts.length), false);
    document.getElementById('dashboard-hint').hidden = true;
    const grid = document.getElementById('board-grid');
    if (!board.charts.length) {
        grid.innerHTML = '<div class="board-empty"><p class="board-empty-title">This dashboard has no charts yet.</p>' +
            '<p>Add a chart and choose what it counts (incidents, changes, requests or tasks), which ones, how to group them, and how to draw it. Or start from a ready-made set and change it from there.</p>' +
            '<div class="board-empty-actions"><button type="button" class="primary-btn" onclick="addBoardChart()">＋ Add a chart</button>' +
            '<button type="button" class="home-action" onclick="addSuggestedCharts()">✨ Add suggested charts</button></div></div>';
        return;
    }
    grid.innerHTML = board.charts.map(c => tileHtml(c, BOARD_TILE_BUTTONS)).join('');
    grid.querySelectorAll('.chart-tile').forEach((tile, i) => fillTile(tile, board.charts[i]));
}

const SUGGESTED_CHARTS = [
    { source: 'incident', status: 'open', display: 'number', size: 'small' },
    { source: 'change_request', status: 'open', display: 'number', size: 'small' },
    { source: 'sc_task', status: 'open', display: 'number', size: 'small' },
    { source: 'incident', groupBy: 'created_day', display: 'area', size: 'large' },
    { source: 'incident', status: 'open', groupBy: 'priority', sort: 'label', display: 'bar' },
    { source: 'change_request', groupBy: 'risk', display: 'donut' },
    { source: 'sc_req_item', groupBy: 'item', display: 'hbar' },
    { source: 'sc_task', status: 'open', groupBy: 'assignment_group', display: 'hbar', color: '7' },
];

function addSuggestedCharts() {
    const board = currentBoard();
    if (!board) return;
    board.charts.push(...SUGGESTED_CHARTS.map(chartWithDefaults));
    savePlace('board');
}

async function newBoard() {
    if (prefs.dashboards.boards.length >= 20) {
        showToast('You can have up to 20 dashboards of your own. Delete one first.');
        return;
    }
    const name = await askText({ title: 'New dashboard', label: 'Name', value: `My dashboard ${prefs.dashboards.boards.length + 1}`, action: 'Create' });
    if (!name) return;
    const board = { id: newChartId(), name: name.slice(0, 60), charts: [] };
    prefs.dashboards.boards.push(board);
    savePreference('dashboards');
    renderMyDashboards();
    toggleAssistant(false);
    switchTab('dashboard');
    await loadDashboards();
    toggleDashboardDrawer(false);
    showBoard(board.id);
}

async function renameBoard() {
    const board = currentBoard();
    if (!board) return;
    const name = await askText({ title: 'Rename dashboard', label: 'Name', value: board.name });
    if (!name) return;
    board.name = name.slice(0, 60);
    savePlace('board');
}

function deleteBoard() {
    const board = currentBoard();
    if (!board || !confirm(`Delete the dashboard "${board.name}" and its ${chartCount(board.charts.length)}? This can't be undone.`)) return;
    prefs.dashboards.boards = prefs.dashboards.boards.filter(b => b !== board);
    hideBoard();
    renderMyDashboards();
    savePreference('dashboards');
    showToast(`Deleted "${board.name}"`);
    showFirstDashboard();
}

function addBoardChart() {
    const board = currentBoard();
    if (!board) return;
    if (board.charts.length >= 30) {
        showToast('A dashboard can hold up to 30 charts. Remove one or start another dashboard.');
        return;
    }
    openBuilder({
        onSave: chart => {
            board.charts.push(chart);
            savePlace('board');
            document.querySelector(`#board-grid .chart-tile[data-chart-id="${CSS.escape(chart.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        },
    });
}

document.addEventListener('click', e => {
    const choice = e.target.closest('[data-board]');
    if (choice && choice.closest('#my-dashboards-list')) {
        showBoard(choice.dataset.board);
        toggleDashboardDrawer(false);
        return;
    }
    const shortcut = e.target.closest('[data-open-board]');
    if (shortcut) openBoard(shortcut.dataset.openBoard);
});

// ---------------------------------------------------------------------
// Team dashboards each person hides from their drawer ("Show or hide")
// ---------------------------------------------------------------------

let drawerEditing = false;

const isDashboardHidden = key => prefs.dashboards.hidden.includes(key);

function applyHiddenDashboards() {
    document.querySelectorAll('#dashboard-picker .dashboard-choice').forEach(b => {
        const hidden = isDashboardHidden(b.dataset.key);
        b.classList.toggle('is-hidden', hidden);
        b.hidden = hidden && !drawerEditing;
        b.title = drawerEditing ? (hidden ? 'Hidden: click to show it in your list' : 'Shown: click to hide it from your list') : '';
        if (drawerEditing) b.setAttribute('aria-pressed', String(!hidden)); else b.removeAttribute('aria-pressed');
    });
    document.querySelectorAll('#dashboard-picker .drawer-group').forEach(g => {
        g.hidden = !drawerEditing && [...g.querySelectorAll('.dashboard-choice')].every(b => b.hidden);
    });
    const count = prefs.dashboards.hidden.length;
    document.getElementById('drawer-hidden-note').textContent = !drawerEditing && count
        ? `${count} team ${count === 1 ? 'dashboard is' : 'dashboards are'} hidden.` : '';
}

function toggleDrawerEditing(on) {
    drawerEditing = typeof on === 'boolean' ? on : !drawerEditing;
    document.getElementById('dashboard-drawer').classList.toggle('editing', drawerEditing);
    const button = document.getElementById('drawer-customize');
    button.textContent = drawerEditing ? '✓ Done' : '👁 Show or hide team dashboards';
    button.setAttribute('aria-pressed', String(drawerEditing));
    applyHiddenDashboards();
}

function toggleDashboardHidden(key) {
    const hidden = prefs.dashboards.hidden;
    prefs.dashboards.hidden = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
    applyHiddenDashboards();
    savePreference('dashboards');
}

// ---------------------------------------------------------------------
// THE CHART BUILDER: what to count, which ones, grouped by what, and how
// it's drawn, with a live preview
// ---------------------------------------------------------------------

const DISPLAY_CHOICES = [
    ['bar', 'Columns', '<rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="6" width="4" height="15" rx="1"/><rect x="17" y="9" width="4" height="12" rx="1"/>'],
    ['hbar', 'Sideways bars', '<rect x="3" y="3" width="15" height="4" rx="1"/><rect x="3" y="10" width="10" height="4" rx="1"/><rect x="3" y="17" width="18" height="4" rx="1"/>'],
    ['line', 'Line', '<polyline points="3,18 9,11 14,14 21,5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'],
    ['area', 'Area', '<path d="M3,18 L9,11 L14,14 L21,5 L21,21 L3,21Z" opacity="0.35"/><polyline points="3,18 9,11 14,14 21,5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'],
    ['donut', 'Donut', '<path d="M12 3a9 9 0 1 1-9 9h4.5A4.5 4.5 0 1 0 12 7.5Z"/><path d="M3 12a9 9 0 0 1 9-9v4.5A4.5 4.5 0 0 0 7.5 12Z" opacity="0.45"/>'],
    ['table', 'Table', '<rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10" width="18" height="2" rx="1" opacity="0.6"/><rect x="3" y="15" width="18" height="2" rx="1" opacity="0.6"/>'],
    ['number', 'One number', '<text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" font-family="sans-serif">123</text>'],
];
const COLOR_CHOICES = [['accent', 'Your accent color'], ...['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red'].map((name, i) => [String(i + 1), name])];
const DATE_CHOICES = [['all', 'Any time'], ['7', 'In the last 7 days of the data'], ['30', 'In the last 30 days of the data'], ['90', 'In the last 90 days of the data'], ['custom', 'Between two dates…']];
const LIMIT_CHOICES = [5, 10, 15, 20, 30, 50];
const MAX_CHART_FILTERS = 6;

let builder = null; // { draft, onSave }
const filterValueCache = new Map();

function loadFilterValues(source, field) {
    const key = `${source}.${field}`;
    if (!filterValueCache.has(key)) {
        const pending = (async () => {
            const response = await fetch(`${API_BASE}/api/charts/values`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ source, field }),
            });
            if (handleUnauthorized(response)) return [];
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
            return data.values;
        })();
        filterValueCache.set(key, pending);
        pending.catch(() => filterValueCache.delete(key));
    }
    return filterValueCache.get(key);
}

// The builder's fixed choices, drawn once
function buildBuilder() {
    const radios = (name, choices, cls = 'choice-pill') => choices.map(([value, label]) =>
        `<label class="${cls}"><input type="radio" name="${name}" value="${value}"><span>${escapeHtml(label)}</span></label>`).join('');
    document.getElementById('b-status').innerHTML = radios('b-status', [['all', 'All'], ['open', 'Open only'], ['closed', 'Closed only']]);
    document.getElementById('b-dates').innerHTML = DATE_CHOICES.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
    document.getElementById('b-limit').innerHTML = LIMIT_CHOICES.map(n => `<option value="${n}">Top ${n}</option>`).join('');
    document.getElementById('b-display').innerHTML = DISPLAY_CHOICES.map(([value, label, icon]) =>
        `<label class="display-choice"><input type="radio" name="b-display" value="${value}">` +
        `<span><svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">${icon}</svg>${escapeHtml(label)}</span></label>`).join('');
    document.getElementById('b-colors').innerHTML = COLOR_CHOICES.map(([value, name]) =>
        `<label class="swatch" title="${escapeHtml(name)}"><input type="radio" name="b-color" value="${value}" aria-label="${escapeHtml(name)}">` +
        `<span style="background:${value === 'accent' ? 'var(--accent)' : `var(--series-${value})`}"></span></label>`).join('');
    document.getElementById('b-sizes').innerHTML = radios('b-size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Wide']]);

    const form = document.getElementById('builder-form');
    form.addEventListener('input', builderInput);
    form.addEventListener('change', builderInput);
    form.addEventListener('submit', e => {
        e.preventDefault();
        saveBuilder();
    });
    // Enter in the choices' search box searches; it doesn't save the chart
    form.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('.filter-search')) e.preventDefault();
    });
    document.getElementById('b-add-filter').addEventListener('click', () => {
        const src = chartCatalog.sources[builder.draft.source];
        const used = new Set(builder.draft.filters.map(f => f.field));
        const field = src.fields.find(([key]) => !used.has(key));
        if (!field || builder.draft.filters.length >= MAX_CHART_FILTERS) return;
        builder.draft.filters.push({ field: field[0], values: [] });
        paintFilters();
        document.querySelector('#b-filters .filter-row:last-child select')?.focus();
    });
    document.getElementById('b-filters').addEventListener('click', e => {
        const remove = e.target.closest('[data-remove-filter]');
        if (!remove) return;
        builder.draft.filters.splice(Number(remove.dataset.removeFilter), 1);
        paintFilters();
        previewSoon();
    });
}

async function openBuilder({ chart = null, onSave }) {
    try {
        if (!await loadChartCatalog()) return;
    } catch (err) {
        showToast(`❌ ${err.message}`);
        return;
    }
    builder = {
        draft: structuredClone(chart || chartWithDefaults({ source: 'incident', groupBy: 'priority', sort: 'label', display: 'bar' })),
        onSave,
    };
    builder.draft.filters = builder.draft.filters.map(f => ({ ...f, values: [...f.values] }));
    document.getElementById('builder-title').textContent = chart ? 'Edit chart' : 'Add a chart';
    document.getElementById('b-save').textContent = chart ? 'Save changes' : 'Add chart';
    document.getElementById('b-source').innerHTML = Object.entries(chartCatalog.sources)
        .map(([key, s]) => `<option value="${key}">${escapeHtml(s.label)}</option>`).join('');
    paintBuilder();
    document.getElementById('chart-builder').showModal();
    document.getElementById('b-source').focus();
    previewSoon(0);
}

function closeBuilder() {
    document.getElementById('chart-builder').close();
}

// The form, from the draft
function paintBuilder() {
    const d = builder.draft;
    const src = chartCatalog.sources[d.source];
    document.getElementById('b-title').value = d.title;
    document.getElementById('b-source').value = d.source;
    document.querySelectorAll('input[name="b-status"]').forEach(r => { r.checked = r.value === d.status; });
    document.getElementById('b-status-note').textContent = `Open = ${src.openStates.join(', ')}. Closed = ${src.closedStates.join(', ')}.`;
    document.getElementById('b-dates').value = d.dates.preset;
    const from = document.getElementById('b-from'), to = document.getElementById('b-to');
    for (const input of [from, to]) { input.min = src.days.first; input.max = src.days.last; }
    from.value = d.dates.from || '';
    to.value = d.dates.to || '';
    document.getElementById('b-range').hidden = d.dates.preset !== 'custom';
    document.getElementById('b-dates-note').textContent = `This data covers ${fmtDay(src.days.first)} to ${fmtDay(src.days.last)}.`;
    document.getElementById('b-group').innerHTML =
        `<option value="">Nothing: show one total</option>` +
        `<optgroup label="Group by">${src.fields.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</optgroup>` +
        `<optgroup label="Over time">${src.times.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</optgroup>`;
    document.getElementById('b-group').value = d.groupBy;
    document.getElementById('b-limit').value = String(d.limit);
    document.getElementById('b-sort').value = d.sort;
    document.querySelectorAll('input[name="b-size"]').forEach(r => { r.checked = r.value === d.size; });
    document.querySelectorAll('input[name="b-color"]').forEach(r => { r.checked = r.value === d.color; });
    paintFilters();
    paintDisplay();
}

// The parts that depend on the grouping and the drawing
function paintDisplay() {
    const d = builder.draft;
    const grouped = Boolean(d.groupBy);
    if (!grouped) d.display = 'number';
    document.querySelectorAll('input[name="b-display"]').forEach(r => {
        r.checked = r.value === d.display;
        r.disabled = !grouped && r.value !== 'number';
    });
    document.getElementById('b-display-note').textContent = grouped
        ? (isTimeField(d.groupBy) && ['bar', 'hbar', 'donut'].includes(d.display) ? 'Tip: Line or Area shows a trend over time best.' : '')
        : 'Choose something to group by to draw a chart; with nothing to group by, the chart is one number.';
    // Top N and order: only for categories (time always shows every period, oldest first)
    document.getElementById('b-cut').hidden = !grouped || isTimeField(d.groupBy) || d.display === 'number';
    document.getElementById('b-color-row').hidden = !['bar', 'hbar', 'line', 'area'].includes(d.display);
    document.getElementById('b-title').placeholder = `${chartAutoTitle(d)} (automatic)`;
}

async function paintFilters() {
    const d = builder.draft;
    const src = chartCatalog.sources[d.source];
    const box = document.getElementById('b-filters');
    box.innerHTML = d.filters.map((f, i) => {
        const others = new Set(d.filters.filter((_, j) => j !== i).map(g => g.field));
        const options = src.fields.filter(([k]) => !others.has(k)).map(([k, l]) => `<option value="${k}"${k === f.field ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
        return `<div class="filter-row" data-filter="${i}"><div class="filter-top">` +
            `<label class="filter-field"><span>Only where</span><select data-filter-field="${i}">${options}</select></label>` +
            `<span class="filter-count" data-filter-count="${i}"></span>` +
            `<button type="button" class="tile-btn" data-remove-filter="${i}" title="Remove this condition" aria-label="Remove this condition">✕</button></div>` +
            `<input type="search" class="filter-search" data-filter-search="${i}" placeholder="Search the choices…" aria-label="Search the choices">` +
            `<div class="filter-values" data-filter-values="${i}"><p class="chart-loading">Loading choices…</p></div></div>`;
    }).join('');
    document.getElementById('b-add-filter').hidden = d.filters.length >= Math.min(MAX_CHART_FILTERS, src.fields.length);
    d.filters.forEach((f, i) => paintFilterValues(i));
}

async function paintFilterValues(i) {
    const d = builder.draft;
    const f = d.filters[i];
    const box = document.querySelector(`[data-filter-values="${i}"]`);
    if (!f || !box) return;
    try {
        const values = await loadFilterValues(d.source, f.field);
        if (builder?.draft !== d || d.filters[i] !== f || !box.isConnected) return;
        const search = (document.querySelector(`[data-filter-search="${i}"]`)?.value || '').trim().toLowerCase();
        const chosen = new Set(f.values);
        // Chosen ones first, then the rest by how common they are
        const list = [...values.filter(v => chosen.has(v.value)), ...values.filter(v => !chosen.has(v.value))]
            .filter(v => !search || v.value.toLowerCase().includes(search));
        const shown = list.slice(0, 100);
        box.innerHTML = shown.map(v => `<label class="filter-value"><input type="checkbox" data-filter-value="${i}" value="${escapeHtml(v.value)}"${chosen.has(v.value) ? ' checked' : ''}>` +
            `<span class="filter-value-name">${escapeHtml(groupLabel({ groupBy: f.field }, v.value))}</span><span class="filter-value-count">${v.count.toLocaleString()}</span></label>`).join('') +
            (list.length > shown.length ? `<p class="filter-more">${(list.length - shown.length).toLocaleString()} more: search to find them</p>` : '') +
            (!list.length ? '<p class="filter-more">Nothing matches that search.</p>' : '');
        paintFilterCount(i);
    } catch (err) {
        box.innerHTML = `<p class="chart-empty error">❌ ${escapeHtml(err.message)}</p>`;
    }
}

function paintFilterCount(i) {
    const f = builder.draft.filters[i];
    const count = document.querySelector(`[data-filter-count="${i}"]`);
    if (f && count) count.textContent = f.values.length ? `${f.values.length} chosen` : 'Pick one or more';
}

// Every change in the form updates the draft, the dependent parts, and the preview
function builderInput(e) {
    const t = e.target;
    const d = builder?.draft;
    if (!d) return;
    if (t.id === 'b-title') { d.title = t.value; previewSoon(); return; }
    if (t.matches('.filter-search')) { if (e.type === 'input') paintFilterValues(Number(t.dataset.filterSearch)); return; }
    if (e.type === 'input' && t.type !== 'color' && t.type !== 'date') return; // selects and radios: on change
    if (t.id === 'b-source') {
        d.source = t.value;
        const src = chartCatalog.sources[d.source];
        if (![...src.fields, ...src.times].some(([k]) => k === d.groupBy)) d.groupBy = src.fields[0][0];
        d.filters = []; // the fields differ between ticket types
        paintBuilder();
    } else if (t.name === 'b-status') {
        d.status = t.value;
        paintDisplay();
    } else if (t.id === 'b-dates') {
        d.dates = t.value === 'custom' ? { preset: 'custom', from: document.getElementById('b-from').value, to: document.getElementById('b-to').value } : { preset: t.value };
        document.getElementById('b-range').hidden = t.value !== 'custom';
    } else if (t.id === 'b-from' || t.id === 'b-to') {
        d.dates = { preset: 'custom', from: document.getElementById('b-from').value, to: document.getElementById('b-to').value };
    } else if (t.matches('[data-filter-field]')) {
        d.filters[Number(t.dataset.filterField)] = { field: t.value, values: [] };
        paintFilters();
    } else if (t.matches('[data-filter-value]')) {
        const f = d.filters[Number(t.dataset.filterValue)];
        f.values = t.checked ? [...f.values, t.value] : f.values.filter(v => v !== t.value);
        paintFilterCount(Number(t.dataset.filterValue));
    } else if (t.id === 'b-group') {
        const wasGrouped = Boolean(d.groupBy);
        d.groupBy = t.value;
        if (d.groupBy && !wasGrouped) d.display = isTimeField(d.groupBy) ? 'line' : 'bar';
        else if (isTimeField(d.groupBy) && ['hbar', 'donut'].includes(d.display)) d.display = 'line';
        paintDisplay();
    } else if (t.name === 'b-display') {
        d.display = t.value;
        paintDisplay();
    } else if (t.id === 'b-limit') {
        d.limit = Number(t.value);
    } else if (t.id === 'b-sort') {
        d.sort = t.value;
    } else if (t.name === 'b-color') {
        d.color = t.value;
    } else if (t.name === 'b-size') {
        d.size = t.value;
    } else {
        return;
    }
    previewSoon();
}

// The chart as it will be saved (conditions with nothing chosen are left out)
function builderChart() {
    const d = builder.draft;
    return { ...d, title: d.title.replace(/\s+/g, ' ').trim().slice(0, 80), filters: d.filters.filter(f => f.values.length).map(f => ({ ...f })) };
}

let previewTimer = null;
function previewSoon(delay = 250) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, delay);
}

function renderPreview() {
    if (!builder) return;
    const chart = builderChart();
    const box = document.getElementById('b-preview');
    let tile = box.querySelector('.chart-tile');
    if (!tile || !tile.classList.contains(`size-${chart.size}`)) {
        box.innerHTML = tileHtml(chart, [], 'preview');
        tile = box.querySelector('.chart-tile');
    }
    fillTile(tile, chart, false);
}

function saveBuilder() {
    if (!builder) return;
    const chart = builderChart();
    const onSave = builder.onSave;
    closeBuilder();
    onSave(chart);
}

document.getElementById('chart-builder').addEventListener('close', () => {
    builder = null;
    clearTimeout(previewTimer);
    document.getElementById('b-preview').innerHTML = '';
    hideChartTip();
});
