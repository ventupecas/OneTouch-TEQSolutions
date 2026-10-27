// =====================================================================
// NOTIFICATIONS: the 🔔 in the header (notifications.mjs on the server):
// tickets someone gave you, a family moved to the team you're the project
// manager of, and someone on your team saying they resolved or closed a
// ticket. Checked every minute while signed in; opening the list marks
// them read. Also the box for telling your project manager you resolved or
// closed a ticket, from a ticket's record and the Team tab.
// Loaded before app.js, whose helpers these functions use when they run.
// =====================================================================

const NOTIFY_CHECK_MS = 60 * 1000;
// How many of a notification's tickets are listed before "and N more"
const NOTIFY_SHOWN_NUMBERS = 8;
// The tickets a member can report on (not orders: they aren't assigned to anyone)
const REPORTABLE = /^(INC|CHG|RITM|SCTASK)\d{7}$/;

const notifyState = {
    items: [],      // the newest ones, newest first
    unread: 0,
    newestId: null, // the newest one seen so far (null: not checked yet), so only later ones pop up
    timer: null,
    run: 0,         // bumped on sign-out, so a check still on its way is dropped
};

// Signing out: nothing of this person's stays on the page
function resetNotifications() {
    clearInterval(notifyState.timer);
    Object.assign(notifyState, { items: [], unread: 0, newestId: null, timer: null, run: notifyState.run + 1 });
    toggleNotifications(false);
    paintNotifyCount();
    document.getElementById('notify-list').innerHTML = '';
}

// Signed in: check now and every minute
function startNotifications() {
    resetNotifications();
    checkNotifications();
    notifyState.timer = setInterval(checkNotifications, NOTIFY_CHECK_MS);
}

async function checkNotifications() {
    if (!sessionTokenValue) return;
    const run = notifyState.run;
    try {
        const response = await fetch(`${API_BASE}/api/notifications`, { headers: authHeaders() });
        if (handleUnauthorized(response) || !response.ok || run !== notifyState.run) return;
        const data = await response.json();
        if (run !== notifyState.run) return;
        // New since the last check (none on the first one: the count says enough)
        const fresh = notifyState.newestId === null ? [] : data.notifications.filter(n => n.id > notifyState.newestId && !n.read);
        notifyState.items = data.notifications;
        notifyState.unread = data.unread;
        notifyState.newestId = Math.max(notifyState.newestId ?? 0, ...data.notifications.map(n => n.id));
        paintNotifyCount();
        if (notificationsOpen()) {
            renderNotifications();
            markNotificationsRead();
        }
        if (fresh.length) showToast(fresh.length === 1 ? `🔔 ${notificationText(fresh[0])}` : `🔔 ${fresh.length} new notifications`);
        // New tickets for them: Home's "Assigned to me" catches up if it's showing
        if (fresh.some(n => n.kind === 'assigned') && homeMode === 'assigned'
            && document.getElementById('home-view').classList.contains('active')) showAssigned(true);
    } catch (err) {
        console.error('Could not check notifications:', err);
    }
}

function paintNotifyCount() {
    const count = document.getElementById('notify-count');
    const button = document.getElementById('notify-btn');
    count.hidden = !notifyState.unread;
    count.textContent = notifyState.unread > 99 ? '99+' : String(notifyState.unread);
    button.setAttribute('aria-label', notifyState.unread ? `Notifications (${notifyState.unread} new)` : 'Notifications');
}

function notificationsOpen() {
    return !document.getElementById('notify-panel').hidden;
}

function toggleNotifications(open) {
    const panel = document.getElementById('notify-panel');
    const button = document.getElementById('notify-btn');
    const willOpen = typeof open === 'boolean' ? open : panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
        toggleThemePanel(false);
        renderNotifications();
        markNotificationsRead();
        panel.querySelector('.drawer-close').focus();
    } else if (panel.contains(document.activeElement)) {
        button.focus();
    }
}

// Seen: the count goes, but they stay highlighted until the list is next drawn
async function markNotificationsRead() {
    if (!notifyState.unread) return;
    notifyState.unread = 0;
    paintNotifyCount();
    try {
        const response = await fetch(`${API_BASE}/api/notifications/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({}),
        });
        handleUnauthorized(response);
    } catch (err) {
        console.error('Could not mark the notifications read:', err);
    }
}

// One notification in words. html: ticket numbers become links, the rest is escaped.
function notificationText(n, html = false) {
    const text = html ? escapeHtml : String;
    const ticket = number => html ? `<button type="button" class="link-btn" data-ticket="${escapeHtml(number)}">${escapeHtml(number)}</button>` : number;
    const d = n.detail || {};
    const who = text(n.actor || 'Someone');
    const count = d.count || n.numbers.length;
    if (n.kind === 'assigned') {
        const on = d.team ? ` on ${text(d.team)}` : '';
        // A whole family at once
        if (d.family && d.size > 1) return `${who} gave you the family of ${d.size.toLocaleString()} linked tickets around ${ticket(d.family)}${on}.`;
        return `${who} gave you ${count === 1 ? ticket(n.numbers[0]) : `${count.toLocaleString()} tickets`}${on}.`;
    }
    if (n.kind === 'family') {
        return count === 1
            ? `${who} moved ${ticket(n.numbers[0])} to ${text(d.team)}. It isn't assigned to anyone yet.`
            : `${who} moved a family of ${count.toLocaleString()} linked tickets to ${text(d.team)}. They aren't assigned to anyone yet.`;
    }
    if (n.kind === 'report') return `${who} says they ${text(d.status)} ${ticket(n.numbers[0])}.`;
    return `${who} sent you a notification.`;
}

function renderNotifications() {
    const list = document.getElementById('notify-list');
    if (!notifyState.items.length) {
        list.innerHTML = '<p class="home-status">Nothing yet. You\'ll hear here when someone gives you tickets. Project managers also hear when a family ' +
            'of tickets is moved to their team, and when someone on it says they resolved or closed a ticket.</p>';
        return;
    }
    list.innerHTML = '<ul class="notify-items">' + notifyState.items.map(n => {
        const d = n.detail || {};
        const count = d.count || n.numbers.length;
        const shown = count > 1 ? n.numbers.slice(0, NOTIFY_SHOWN_NUMBERS) : [];
        const more = count - shown.length;
        return `<li class="notify-item${n.read ? '' : ' unread'}">` +
            `<div class="notify-text">${notificationText(n, true)}</div>` +
            (d.note ? `<blockquote class="notify-note">${escapeHtml(d.note)}</blockquote>` : '') +
            (shown.length ? `<div class="notify-tickets">${shown.map(number =>
                `<button type="button" class="link-btn" data-ticket="${escapeHtml(number)}">${escapeHtml(number)}</button>`).join(', ')}` +
                (more > 0 ? ` and ${more.toLocaleString()} more` : '') + '</div>' : '') +
            `<div class="notify-foot"><span>${escapeHtml(formatShownAt(n.at))}</span>` +
            (n.kind === 'report' ? '' : '<button type="button" class="link-btn" data-notify-team>Open the Team tab</button>') +
            '</div></li>';
    }).join('') + '</ul>';
}

document.getElementById('notify-panel').addEventListener('click', e => {
    // A ticket number: app.js's click listener opens it; the list gets out of the way
    if (e.target.closest('[data-ticket]')) { toggleNotifications(false); return; }
    if (e.target.closest('[data-notify-team]')) {
        toggleNotifications(false);
        switchTab('teams');
    }
});

// A click outside the list closes it
document.addEventListener('pointerdown', e => {
    const panel = document.getElementById('notify-panel');
    if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#notify-btn')) toggleNotifications(false);
});

// Back to this tab after a while: check straight away
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && notifyState.timer) checkNotifications();
});

// ---------------------------------------------------------------------
// Telling your project manager you resolved or closed a ticket. Only a
// notification for them: the ticket's data doesn't change.
// ---------------------------------------------------------------------

let reportNumber = null;

// Anyone on a team except its project manager (and admins, who have none)
function canTellManager() {
    return Boolean(currentAccess.team) && !currentAccess.admin && currentAccess.role !== 'project_manager';
}

// The button, for a ticket's record (app.js) and the Team tab (teams.js)
function reportButtonHtml(number, label = '✅ Tell my project manager') {
    if (!canTellManager() || !REPORTABLE.test(number)) return '';
    return `<button type="button" class="home-action" data-report="${escapeHtml(number)}">${escapeHtml(label)}</button>`;
}

function openReportDialog(number) {
    const dialog = document.getElementById('report-dialog');
    reportNumber = number;
    document.getElementById('report-ticket').textContent = `${number}: did you resolve it or close it? Your project manager hears about it.`;
    document.getElementById('report-status').value = 'resolved';
    document.getElementById('report-note').value = '';
    document.getElementById('report-error').hidden = true;
    dialog.showModal();
    document.getElementById('report-status').focus();
}

document.querySelector('#report-dialog form').addEventListener('submit', async e => {
    e.preventDefault();
    const number = reportNumber;
    const status = document.getElementById('report-status').value;
    const send = document.getElementById('report-send');
    const error = document.getElementById('report-error');
    send.disabled = true;
    error.hidden = true;
    try {
        const response = await fetch(`${API_BASE}/api/tickets/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ number, status, note: document.getElementById('report-note').value }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'That didn\'t work. Please try again.');
        document.getElementById('report-dialog').close();
        const names = data.told.length > 1 ? `${data.told.slice(0, -1).join(', ')} and ${data.told.at(-1)}` : data.told[0];
        showToast(`✓ Told ${names} that you ${status} ${number}`);
        // The Team tab shows it next to the ticket
        if (document.getElementById('teams-view').classList.contains('active')) loadTeamTickets();
    } catch (err) {
        error.textContent = `❌ ${err.message}`;
        error.hidden = false;
    } finally {
        send.disabled = false;
    }
});

document.addEventListener('click', e => {
    const report = e.target.closest('[data-report]');
    if (report) openReportDialog(report.dataset.report);
});
