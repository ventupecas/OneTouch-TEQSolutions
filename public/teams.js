// =====================================================================
// TEAMS: the Team tab (teams.mjs on the server). Admins see every team -
// who's on it and in what role, its tickets and who has each one - and can
// put people on teams and move families between teams. A project manager
// sees their own team the same way and hands out its tickets. Everyone
// else sees who's on their team and the tickets assigned to them.
// Loaded before app.js, whose helpers these functions use when they run.
// =====================================================================

const TEAM_PAGE_SIZE = 50;
const TEAM_KINDS = [['INC', 'Incidents'], ['CHG', 'Changes'], ['RITM', 'Requests'], ['SCTASK', 'Catalog tasks']];

const teamsView = {
    data: null,     // GET /api/teams: { teams, roles, people? }
    teamId: null,   // the team showing
    filter: { assignee: '', kind: '', search: '' },
    offset: 0,
    run: 0,         // bumped on every load, so an answer for an older view is dropped
};

// Signing out: nothing of this person's team stays on the page
function resetTeams() {
    teamsView.data = null;
    teamsView.teamId = null;
    teamsView.filter = { assignee: '', kind: '', search: '' };
    teamsView.offset = 0;
    teamsView.run += 1;
    document.getElementById('teams').innerHTML = '';
}

// -> the JSON answer, or null if the session ended; a refusal throws its message
async function teamsFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (handleUnauthorized(response)) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'That didn\'t work. Please try again.');
    return data;
}

const currentTeam = () => teamsView.data?.teams.find(t => t.id === teamsView.teamId) || null;
const roleName = role => teamsView.data?.roles[role] || '';

async function loadTeams() {
    const box = document.getElementById('teams');
    if (!teamsView.data) box.innerHTML = '<p class="home-status">Loading your team…</p>';
    try {
        const data = await teamsFetch('/api/teams');
        if (!data) return;
        teamsView.data = data;
        if (!currentTeam()) {
            const mine = data.teams.find(t => t.id === currentAccess.team?.id) || data.teams[0];
            teamsView.teamId = mine ? mine.id : null;
        }
        renderTeams();
    } catch (err) {
        box.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
}

// After an assignment or a move: the counts again, keeping the ticket list as it is
async function refreshTeamCounts() {
    try {
        const data = await teamsFetch('/api/teams');
        if (!data) return;
        teamsView.data = data;
        const summary = document.getElementById('team-summary');
        if (summary && currentTeam()) summary.innerHTML = teamSummaryHtml(currentTeam());
        const picker = document.getElementById('team-picker');
        if (picker) picker.innerHTML = teamPickerHtml();
    } catch (err) {
        console.error('Could not refresh the team counts:', err);
    }
}

function youLine(team) {
    if (currentAccess.admin) return 'You\'re an admin: you see every team and every ticket, put people on teams, and move families between them.';
    if (!team) return 'You\'re not on a team yet, so no tickets are assigned to you. An admin can add you to one.';
    if (currentAccess.role === 'project_manager') return `You're the project manager of ${team.name}: you see all of its tickets, hand them out, and see who's working on what.`;
    return `You're on ${team.name} as ${roleName(currentAccess.role).toLowerCase()}. You see the tickets assigned to you, ` +
        'and when you resolve or close one you can tell your project manager from its row.';
}

function renderTeams() {
    const { data } = teamsView;
    const team = currentTeam();
    const box = document.getElementById('teams');
    let html = `<div class="home-head"><h2 class="home-welcome">👥 ${currentAccess.admin ? 'Teams' : escapeHtml(team?.name || 'Your team')}</h2></div>` +
        `<p class="home-status">${escapeHtml(youLine(team))}</p>`;
    if (currentAccess.admin) html += `<div class="team-picker" id="team-picker">${teamPickerHtml()}</div>`;
    if (team) {
        const manage = team.canManage;
        html += `<section class="team-card" id="team-summary">${teamSummaryHtml(team)}</section>` +
            `<section class="team-card">` +
            `<h3>${manage ? `${escapeHtml(team.name)}'s tickets` : 'My tickets'}</h3>` +
            `<div class="team-filters">` +
            (manage ? `<label>Who has it <select id="team-filter-assignee">${assigneeFilterOptions(team)}</select></label>` : '') +
            `<label>Type <select id="team-filter-kind"><option value="">All types</option>` +
            TEAM_KINDS.map(([k, label]) => `<option value="${k}"${teamsView.filter.kind === k ? ' selected' : ''}>${label}</option>`).join('') +
            `</select></label>` +
            `<label>Ticket number <input type="search" id="team-filter-search" value="${escapeHtml(teamsView.filter.search)}" placeholder="e.g. 1813970"></label>` +
            `<button type="button" class="home-action" data-team-search>Search</button>` +
            `</div>` +
            (manage ? `<div class="team-bulk"><label><input type="checkbox" class="team-select-all"> Tick all on this page</label>` +
                `<span>Give the ticked tickets to</span> <select id="team-bulk-to" aria-label="Give the ticked tickets to">${assigneeOptions(team, null)}</select>` +
                `<button type="button" class="home-action" data-team-bulk>Assign</button></div>` : '') +
            `<div id="team-tickets"></div></section>`;
    }
    if (currentAccess.admin) html += familyCardHtml() + peopleCardHtml(data.people || []);
    box.innerHTML = html;
    if (team) loadTeamTickets();
}

function teamPickerHtml() {
    return teamsView.data.teams.map(t =>
        `<button type="button" class="team-pick${t.id === teamsView.teamId ? ' active' : ''}" data-team-pick="${t.id}">` +
        `<span class="team-pick-name">${escapeHtml(t.name)}${t.test ? ' <span class="team-test-tag">Test team</span>' : ''}</span>` +
        `<span class="team-pick-meta">${t.tickets.toLocaleString()} tickets · ${t.members.length} people</span></button>`).join('');
}

function loadCells(load) {
    if (!load) return TEAM_KINDS.map(() => '<td class="num">—</td>').join('') + '<td class="num">—</td>';
    return TEAM_KINDS.map(([k]) => `<td class="num">${load[k].toLocaleString()}</td>`).join('') +
        `<td class="num"><strong>${load.total.toLocaleString()}</strong></td>`;
}

// Who's on the team, in what role, and (for whoever manages it) how many of each type they have
function teamSummaryHtml(team) {
    const manage = team.canManage;
    const admin = currentAccess.admin;
    const unassigned = team.unassigned?.total || 0;
    const head = '<th>Name</th><th>Role</th>' + TEAM_KINDS.map(([, label]) => `<th class="num">${label}</th>`).join('') + '<th class="num">Total</th>' +
        (manage ? '<th></th>' : '') + (admin ? '<th>Team</th>' : '');
    const rows = team.members.map(m =>
        `<tr${m.username === currentUsername ? ' class="team-you"' : ''}>` +
        `<td>${escapeHtml(m.name)}${m.username === currentUsername ? ' <span class="team-you-tag">you</span>' : ''}</td>` +
        `<td>${admin ? roleSelectHtml(`data-member-role="${m.id}"`, m.role) : escapeHtml(roleName(m.role))}</td>` +
        loadCells(m.load) +
        (manage ? `<td><button type="button" class="home-action" data-team-show="${m.id}">Their tickets</button></td>` : '') +
        (admin ? `<td><div class="team-member-team">${teamSelectHtml(`data-member-team="${m.id}"`, team.id, true, m.test)}` +
            `<button type="button" class="home-action danger" data-member-remove="${m.id}" title="Take ${escapeHtml(m.name)} off ${escapeHtml(team.name)} and away from their role">Remove from team</button></div></td>` : '') +
        '</tr>').join('');
    const unassignedRow = manage
        ? `<tr class="team-unassigned"><td>Not assigned yet</td><td>—</td>${loadCells(team.unassigned)}` +
          `<td><button type="button" class="home-action" data-team-show="none"${unassigned ? '' : ' disabled'}>Show them</button></td>${admin ? '<td></td>' : ''}</tr>`
        : '';
    return `<h3>${escapeHtml(team.name)}${team.test ? ' <span class="team-test-tag">Test team</span>' : ''}</h3>` +
        `<p class="home-status">${team.tickets.toLocaleString()} tickets in ${team.families.toLocaleString()} families · ${team.members.length} people` +
        (manage && unassigned ? ` · <strong>${unassigned.toLocaleString()} not assigned yet</strong>` : '') + '</p>' +
        (team.members.length
            ? `<div class="table-wrap"><table class="result-table team-table"><thead><tr>${head}</tr></thead><tbody>${rows}${unassignedRow}</tbody></table></div>`
            : '<p class="home-status">Nobody is on this team yet.</p>');
}

function roleSelectHtml(attr, selected) {
    return `<select ${attr} aria-label="Role">` + Object.entries(teamsView.data.roles)
        .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('') + '</select>';
}

// testOnly: for a test account, which may only join a test team
function teamSelectHtml(attr, selected, withNone, testOnly = false) {
    return `<select ${attr} aria-label="Team">` + (withNone ? `<option value="">No team</option>` : '') + teamsView.data.teams
        .filter(t => !testOnly || t.test)
        .map(t => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('') + '</select>';
}

// The team's people to give a ticket to (or nobody)
function assigneeOptions(team, selected) {
    return `<option value=""${selected ? '' : ' selected'}>Not assigned</option>` + team.members
        .map(m => `<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(roleName(m.role))})</option>`).join('');
}

function assigneeFilterOptions(team) {
    const f = teamsView.filter.assignee;
    return `<option value=""${f ? '' : ' selected'}>Everyone</option><option value="none"${f === 'none' ? ' selected' : ''}>Not assigned yet</option>` +
        team.members.map(m => `<option value="${m.id}"${String(m.id) === f ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
}

async function loadTeamTickets() {
    const team = currentTeam();
    const out = document.getElementById('team-tickets');
    if (!team || !out) return;
    const run = ++teamsView.run;
    out.innerHTML = '<p class="home-status">Loading tickets…</p>';
    const q = new URLSearchParams({ offset: teamsView.offset, limit: TEAM_PAGE_SIZE });
    for (const [key, value] of Object.entries(teamsView.filter)) if (value) q.set(key, value);
    try {
        const data = await teamsFetch(`/api/teams/${team.id}/tickets?${q}`);
        if (!data || run !== teamsView.run) return;
        out.innerHTML = teamTicketsHtml(team, data);
        const all = document.querySelector('#teams .team-select-all');
        if (all) all.checked = false;
    } catch (err) {
        if (run === teamsView.run) out.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
}

function teamTicketsHtml(team, data) {
    if (!data.total) {
        return `<p class="home-status">${teamsView.filter.assignee || teamsView.filter.kind || teamsView.filter.search
            ? 'No tickets match.' : team.canManage ? 'This team has no tickets.' : 'No tickets are assigned to you yet.'}</p>`;
    }
    const manage = team.canManage;
    const admin = currentAccess.admin;
    // Members tell their project manager when they've resolved or closed one (notifications.js)
    const tell = !manage && canTellManager();
    const rows = data.tickets.map(t => {
        const n = escapeHtml(t.number);
        const summary = String(t.summary || '');
        const family = t.family.size > 1
            ? `${t.family.size.toLocaleString()} linked tickets` + (admin ? ` <button type="button" class="link-btn" data-family-find="${n}" title="Move this family to another team">Move…</button>` : '')
            : 'On its own' + (admin ? ` <button type="button" class="link-btn" data-family-find="${n}" title="Move this ticket to another team">Move…</button>` : '');
        return '<tr>' +
            (manage ? `<td class="select-cell"><input type="checkbox" class="team-select" value="${n}" aria-label="Tick ${n}"></td>` : '') +
            `<td class="ticket-cell"><button type="button" class="ticket-link" data-ticket="${n}" title="Open ${n}">${n}</button>${starButtonHtml(t.number)}</td>` +
            `<td>${escapeHtml(t.type || '—')}</td>` +
            `<td${summary.length > 100 ? ` title="${escapeHtml(summary)}"` : ''}>${escapeHtml(summary.length > 100 ? `${summary.slice(0, 97)}…` : summary || '—')}</td>` +
            `<td>${escapeHtml(t.state || '—')}${reportLineHtml(t.report)}</td>` +
            `<td>${family}</td>` +
            `<td>${manage
                ? `<select class="team-assign" data-number="${n}" aria-label="Who has ${n}">${assigneeOptions(team, t.assignee?.id ?? null)}</select>`
                : escapeHtml(t.assignee?.name || 'Not assigned')}</td>` +
            (tell ? `<td>${reportButtonHtml(t.number, t.report?.mine ? 'Tell them again…' : 'Resolved or closed?…')}</td>` : '') +
            '</tr>';
    }).join('');
    const first = teamsView.offset + 1;
    const last = teamsView.offset + data.tickets.length;
    return `<div class="table-wrap"><table class="result-table"><thead><tr>` +
        (manage ? '<th class="select-cell"></th>' : '') +
        '<th>Ticket</th><th>Type</th><th>Summary</th><th>State</th><th>Family</th><th>Assigned to</th>' +
        (tell ? '<th>Tell your project manager</th>' : '') +
        `</tr></thead><tbody>${rows}</tbody></table></div>` +
        `<div class="team-pager"><span>${first.toLocaleString()}–${last.toLocaleString()} of ${data.total.toLocaleString()}</span>` +
        `<button type="button" class="home-action" data-team-page="-1"${teamsView.offset ? '' : ' disabled'}>← Previous</button>` +
        `<button type="button" class="home-action" data-team-page="1"${last < data.total ? '' : ' disabled'}>Next →</button></div>`;
}

// Under a ticket's state: the latest time someone told the project manager
// they'd resolved or closed it (the state itself is the data's, unchanged)
function reportLineHtml(report) {
    if (!report) return '';
    const note = String(report.note || '');
    return `<div class="team-report"${note ? ` title="${escapeHtml(note)}"` : ''}>✅ ` +
        (report.mine ? `You told your project manager you ${escapeHtml(report.status)} it` : `${escapeHtml(report.by || 'Someone')} says it's ${escapeHtml(report.status)}`) +
        ` · ${escapeHtml(formatShownAt(report.at))}` +
        (note ? `<span class="team-report-note">“${escapeHtml(note.length > 80 ? `${note.slice(0, 77)}…` : note)}”</span>` : '') +
        '</div>';
}

async function assign(numbers, assigneeId) {
    const data = await teamsFetch('/api/assignments', { method: 'PUT', body: JSON.stringify({ numbers, assigneeId }) });
    if (!data) return false;
    const team = currentTeam();
    const who = assigneeId ? team?.members.find(m => m.id === assigneeId)?.name : null;
    showToast(numbers.length === 1
        ? `${numbers[0]} ${who ? `is now ${who}'s` : 'is not assigned now'}`
        : `${data.changed.toLocaleString()} tickets ${who ? `given to ${who}` : 'unassigned'}`);
    refreshTeamCounts();
    return true;
}

// ---------------------------------------------------------------------
// Admins: moving a family (all the tickets linked to each other) to another team
// ---------------------------------------------------------------------

function familyCardHtml() {
    return `<section class="team-card"><h3>Move tickets to another team</h3>` +
        `<p class="home-status">Tickets linked to each other (a parent incident and its children, a request and its tasks, an order, ` +
        `a problem, a change and its incidents) are one family, and a family always belongs to one team. So moving a ticket moves its whole family.</p>` +
        `<div class="team-filters"><label>Any ticket in the family <input type="search" id="family-find" placeholder="e.g. INC1813970"></label>` +
        `<button type="button" class="home-action" data-family-lookup>Find its family</button></div>` +
        `<div id="family-found"></div></section>`;
}

async function findFamily(number) {
    const out = document.getElementById('family-found');
    const input = document.getElementById('family-find');
    if (number) input.value = number;
    const wanted = input.value.trim();
    if (!wanted) return;
    out.innerHTML = '<p class="home-status">Looking…</p>';
    input.closest('.team-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
        const data = await teamsFetch(`/api/ticket-families?number=${encodeURIComponent(wanted)}`);
        if (!data) return;
        const f = data.family;
        const kinds = TEAM_KINDS.filter(([k]) => f.kinds[k]).map(([k, label]) => `${f.kinds[k].toLocaleString()} ${label.toLowerCase()}`).join(', ');
        out.innerHTML = `<p>${f.size === 1 ? `<strong>${escapeHtml(f.number)}</strong> isn't linked to any other ticket` : `<strong>${f.size.toLocaleString()} linked tickets</strong> (${kinds})`}, ` +
            `now with <strong>${escapeHtml(f.team?.name || 'no team')}</strong>.` +
            (f.size > 1 ? ` Includes ${f.sample.map(escapeHtml).join(', ')}${f.size > f.sample.length ? ', …' : ''}.` : '') + '</p>' +
            `<div class="team-filters"><label>Move to ${teamSelectHtml('id="family-move-to"', f.team?.id ?? null, false)}</label>` +
            `<button type="button" class="home-action" data-family-move="${escapeHtml(f.id)}">Move ${f.size === 1 ? 'it' : `all ${f.size.toLocaleString()}`}</button></div>` +
            `<p class="home-status">They become unassigned, for the new team's project manager to hand out.</p>`;
    } catch (err) {
        out.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
    }
}

async function moveFamily(familyId) {
    const teamId = Number(document.getElementById('family-move-to').value);
    const team = teamsView.data.teams.find(t => t.id === teamId);
    try {
        const data = await teamsFetch(`/api/ticket-families/${encodeURIComponent(familyId)}/team`, { method: 'PUT', body: JSON.stringify({ teamId }) });
        if (!data) return;
        document.getElementById('family-found').innerHTML = data.moved
            ? `<p class="home-status">✓ Moved ${data.moved.toLocaleString()} ${data.moved === 1 ? 'ticket' : 'tickets'} to ${escapeHtml(team.name)}. ${escapeHtml(team.name)}'s project manager can now hand them out.</p>`
            : `<p class="home-status">That family is already ${escapeHtml(team.name)}'s.</p>`;
        await refreshTeamCounts();
        loadTeamTickets();
    } catch (err) {
        showToast(err.message);
    }
}

// ---------------------------------------------------------------------
// Admins: people on no team, and changing anyone's team or role
// ---------------------------------------------------------------------

function peopleCardHtml(people) {
    const rows = people.map(p => `<tr><td>${escapeHtml(p.name)}${p.test ? ' <span class="team-test-tag">Test account</span>' : ''}</td>` +
        `<td>${teamSelectHtml(`data-person-team="${p.id}"`, teamsView.teamId, false, p.test)}</td>` +
        `<td>${roleSelectHtml(`data-person-role="${p.id}"`, 'project_team')}</td>` +
        `<td><button type="button" class="home-action" data-person-add="${p.id}">Add</button></td></tr>`).join('');
    return `<section class="team-card"><h3>People on no team</h3>` +
        (people.length
            ? `<p class="home-status">They see no tickets until they're on a team and have tickets assigned. Test accounts can only join a test team.</p>` +
              `<div class="table-wrap"><table class="result-table team-table"><thead><tr><th>Name</th><th>Team</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : '<p class="home-status">Everyone is on a team. (Admins, the warm-up account and the test accounts don\'t join one.)</p>') +
        '</section>';
}

// done: what the toast says, from the answer ({ unassigned })
async function setMembership(userId, teamId, role, done = () => 'Saved') {
    try {
        const data = await teamsFetch(`/api/teams/members/${userId}`, { method: 'PUT', body: JSON.stringify({ teamId, role }) });
        if (!data) return;
        showToast(done(data));
        await loadTeams();
    } catch (err) {
        showToast(err.message);
        loadTeams();
    }
}

// ---------------------------------------------------------------------
// Clicks and changes anywhere in the Team tab
// ---------------------------------------------------------------------

document.getElementById('teams-view').addEventListener('click', e => {
    const pick = e.target.closest('[data-team-pick]');
    if (pick) {
        teamsView.teamId = Number(pick.dataset.teamPick);
        teamsView.filter = { assignee: '', kind: '', search: '' };
        teamsView.offset = 0;
        renderTeams();
        return;
    }
    const show = e.target.closest('[data-team-show]');
    if (show) {
        teamsView.filter.assignee = show.dataset.teamShow;
        teamsView.offset = 0;
        const select = document.getElementById('team-filter-assignee');
        if (select) select.value = teamsView.filter.assignee;
        loadTeamTickets();
        document.getElementById('team-tickets').closest('.team-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const page = e.target.closest('[data-team-page]');
    if (page) {
        teamsView.offset = Math.max(0, teamsView.offset + Number(page.dataset.teamPage) * TEAM_PAGE_SIZE);
        loadTeamTickets();
        return;
    }
    if (e.target.closest('[data-team-search]')) {
        teamsView.filter.search = document.getElementById('team-filter-search').value.trim();
        teamsView.offset = 0;
        loadTeamTickets();
        return;
    }
    if (e.target.closest('[data-team-bulk]')) {
        const numbers = [...document.querySelectorAll('#team-tickets .team-select:checked')].map(b => b.value);
        if (!numbers.length) { showToast('Tick some tickets first'); return; }
        const to = document.getElementById('team-bulk-to').value;
        assign(numbers, to ? Number(to) : null).then(ok => { if (ok) loadTeamTickets(); }).catch(err => showToast(err.message));
        return;
    }
    const find = e.target.closest('[data-family-find]');
    if (find) { findFamily(find.dataset.familyFind); return; }
    if (e.target.closest('[data-family-lookup]')) { findFamily(); return; }
    const move = e.target.closest('[data-family-move]');
    if (move) { moveFamily(move.dataset.familyMove); return; }
    const remove = e.target.closest('[data-member-remove]');
    if (remove) {
        const team = currentTeam();
        const member = team?.members.find(m => m.id === Number(remove.dataset.memberRemove));
        if (!member) return;
        const held = member.load?.total || 0;
        if (!confirm(`Take ${member.name} off ${team.name}? They stop being its ${roleName(member.role).toLowerCase()} and stop seeing its tickets.` +
            (held ? ` Their ${held.toLocaleString()} ${held === 1 ? 'ticket stays' : 'tickets stay'} with ${team.name}, unassigned, for its project manager to hand out.` : ''))) return;
        setMembership(member.id, null, null, data => `${member.name} is off ${team.name}` +
            (data.unassigned ? `; ${data.unassigned.toLocaleString()} ${data.unassigned === 1 ? 'ticket is' : 'tickets are'} unassigned now` : ''));
        return;
    }
    const add = e.target.closest('[data-person-add]');
    if (add) {
        const id = add.dataset.personAdd;
        const row = add.closest('tr');
        setMembership(Number(id), Number(row.querySelector('[data-person-team]').value), row.querySelector('[data-person-role]').value);
    }
});

document.getElementById('teams-view').addEventListener('change', e => {
    const t = e.target;
    if (t.classList.contains('team-assign')) {
        const previous = [...t.options].find(o => o.defaultSelected)?.value ?? '';
        assign([t.dataset.number], t.value ? Number(t.value) : null)
            .then(() => { for (const o of t.options) o.defaultSelected = o.selected; })
            .catch(err => { t.value = previous; showToast(err.message); });
    } else if (t.id === 'team-filter-assignee' || t.id === 'team-filter-kind') {
        teamsView.filter[t.id === 'team-filter-kind' ? 'kind' : 'assignee'] = t.value;
        teamsView.offset = 0;
        loadTeamTickets();
    } else if (t.classList.contains('team-select-all')) {
        for (const box of document.querySelectorAll('#team-tickets .team-select')) box.checked = t.checked;
    } else if (t.dataset.memberRole) {
        const row = t.closest('tr');
        setMembership(Number(t.dataset.memberRole), Number(row.querySelector('[data-member-team]').value) || null, t.value);
    } else if (t.dataset.memberTeam !== undefined) {
        const row = t.closest('tr');
        const name = row.cells[0].textContent.replace(/\s*you$/, '');
        const leaving = t.value ? `move ${name} to ${t.options[t.selectedIndex].text}` : `take ${name} off the team`;
        if (!confirm(`Do you want to ${leaving}? Their tickets stay with this team, unassigned, for its project manager to hand out.`)) {
            t.value = String(teamsView.teamId);
            return;
        }
        setMembership(Number(t.dataset.memberTeam), t.value ? Number(t.value) : null, row.querySelector('[data-member-role]').value);
    }
});

document.getElementById('teams-view').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'team-filter-search') document.querySelector('#teams [data-team-search]').click();
    if (e.target.id === 'family-find') findFamily();
});
