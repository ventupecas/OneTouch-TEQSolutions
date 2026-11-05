// =====================================================================
// 🧊 ARCHITECTURE (admins only): a 3D map of how OneTouch is built, and the
// ServiceNow live push, which is built but needs ServiceNow's authentication.
//
// This file can be read without signing in, so it only holds the drawing
// code. Everything the map says comes from GET /api/architecture, which only
// answers admins (architecture.mjs). three.js is loaded the first time an
// admin opens the map, so nobody else's page pays for it.
//
// The same content is in a list (📝 List), for screen readers and for
// browsers that can't draw 3D. One function, so its names can't clash with
// the other page scripts.
// =====================================================================

(function () {
    'use strict';

    const THREE_URL = './vendor/three-0.186.1/three.module.js';
    const POLL_MS = 20 * 1000;
    const DIM = 0.14; // how faint what isn't in focus gets

    let map = null;        // what the server said; null until loaded and after sign-out
    let world = null;      // the 3D scene; null when only the list can be shown
    let active = false;
    let loading = null;    // the first opening, while it's still under way
    let opening = 0;       // goes up at sign-out, so a late answer can't draw the map for the next person
    let mode = '3d';       // '3d' or 'list'
    let sideTab = 'details';
    let selected = null;   // a block's id
    let focusLayer = null; // a layer's id
    let pollTimer = null;
    let health = null;     // the last health report (GET /api/architecture/health)
    let healthError = null;// why there isn't a fresh one
    let healthErrorSince = null;
    let issues = null;     // what people have reported: { openCount, open, resolved }
    let sideShown = null;  // the tab the side panel last drew, so a redraw keeps its place
    const RAIL_KEY = 'onetouch-arch-rail-min';
    let railMin = false;   // the left side bar minimized
    try { railMin = localStorage.getItem(RAIL_KEY) === '1'; } catch { /* Open, then */ }
    const player = { flow: null, index: 0, playing: false, elapsed: 0, hold: 0 };

    const $ = id => document.getElementById(id);
    const esc = value => escapeHtml(String(value ?? ''));
    const nodeById = id => map.nodes.find(n => n.id === id);
    const layerById = id => map.layers.find(l => l.id === id);
    const lessMotion = () => document.documentElement.classList.contains('a11y-motion')
        || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const receiving = () => map?.push.state === 'receiving';
    const colorVar = name => `var(--${/^(series-[1-8]|warn)$/.test(name) ? name : 'muted'})`;

    // -----------------------------------------------------------------
    // The page's text (everything but the scene)
    // -----------------------------------------------------------------

    function pageHtml() {
        // The status and the rail first: keys and screen readers reach them before the blocks' names
        return `
            <div class="arch-status" id="arch-status" role="status"></div>
            <nav class="arch-rail" id="arch-rail" aria-label="Architecture map"></nav>
            <div class="arch-stage" id="arch-stage" tabindex="0" role="group"
                 aria-label="3D map of OneTouch. Arrow keys turn it, plus and minus zoom, 0 resets the view. Each block is a button. The List view has the same information.">
                <canvas id="arch-canvas" aria-hidden="true"></canvas>
                <div class="arch-tags" id="arch-tags"></div>
                <p class="arch-hint">Drag to turn · scroll to zoom · Shift+drag to move · click a block. Moving dots show which way data goes, not live traffic.</p>
            </div>
            <div class="arch-list" id="arch-list" hidden></div>
            <section class="arch-step" id="arch-step" aria-live="polite" hidden></section>
            <aside class="arch-side" id="arch-side" aria-label="Details"></aside>`;
    }

    // What isn't working right now: the health report, or the server not answering at all
    function problems() {
        if (healthError) return [{ id: 'server', name: 'OneTouch server', text: healthError, effect: 'What this page shows may be out of date.', since: healthErrorSince }];
        return (health?.checks || []).filter(c => c.state === 'problem');
    }

    function statusHtml() {
        const list = problems();
        const shown = list.slice(0, 3);
        const bad = !list.length ? '' : `<div class="arch-status-row arch-status-problems">
                <span class="arch-chip arch-chip-stop">⚠️ ${list.length} problem${list.length === 1 ? '' : 's'}</span>
                <span class="arch-status-text">${shown.map(p => `<b>${esc(p.name)}:</b> ${esc(p.text)}`).join('<br>')}${list.length > shown.length ? `<br>and ${list.length - shown.length} more` : ''}</span>
                <button type="button" class="arch-btn" data-side="health">See what's wrong</button>
            </div>`;
        const open = issues?.openCount || 0;
        const latest = issues?.open[0];
        const reported = !open ? '' : `<div class="arch-status-row arch-status-problems">
                <span class="arch-chip arch-chip-warn">📣 ${open} open report${open === 1 ? '' : 's'}</span>
                <span class="arch-status-text">${latest ? `<b>Latest, from ${esc(latest.reporter)}:</b> ${esc(latest.label)}` : ''}</span>
                <button type="button" class="arch-btn" data-side="reports">See the reports</button>
            </div>`;
        return `${bad}${reported}<div class="arch-status-row">${pushStatusHtml()}</div>`;
    }

    // One report. Someone's own words, so escaped like everything else here.
    function reportHtml(r, resolved) {
        const where = r.page ? ` · on ${esc(r.page)}` : '';
        const done = resolved ? `<br><span class="arch-small">Resolved ${esc(when(r.resolvedAt))}${r.resolver ? ` by ${esc(r.resolver)}` : ''}.</span>` : '';
        return `<li class="arch-report">
                <span class="arch-report-kind">${esc(r.label)}</span>
                <p class="arch-report-message">${esc(r.message)}</p>
                <span class="arch-small"><b>${esc(r.reporter)}</b> · ${esc(when(r.at))}${where}</span>${done}
                ${r.browser ? `<br><span class="arch-small">${esc(r.browser)}</span>` : ''}
                <div class="arch-report-foot">
                    <button type="button" class="arch-btn" data-issue="${esc(r.id)}" data-issue-status="${resolved ? 'open' : 'resolved'}">${resolved ? '↩ Reopen' : '✓ Mark resolved'}</button>
                </div>
            </li>`;
    }

    // What people have told the admins (the 🚩 in the header)
    function reportsHtml(Heading = 'h3') {
        const title = `<${Heading} class="arch-node-name">📣 Problems people reported</${Heading}>`;
        if (!issues) return `${title}<p>Loading the reports…</p>`;
        const open = issues.open.length
            ? `<ul class="arch-checks">${issues.open.map(r => reportHtml(r, false)).join('')}</ul>`
            : '<p class="arch-notice arch-notice-good"><b>✅ No open reports.</b></p>';
        const resolved = issues.resolved.length
            ? `<details class="arch-reports-done"><summary>Resolved lately (${issues.resolved.length})</summary>
                <ul class="arch-checks">${issues.resolved.map(r => reportHtml(r, true)).join('')}</ul></details>` : '';
        return `${title}${open}${resolved}
            <p class="arch-small">Anyone signed in can send one with the 🚩 in the header. Admins are told under the 🔔 and by email.</p>`;
    }

    // Every check: what's wrong first, then what's working
    function healthHtml(Heading = 'h3') {
        const rank = { problem: 0, off: 1, ok: 2 };
        const checks = [...(health?.checks || [])].sort((a, b) => rank[a.state] - rank[b.state]);
        const list = problems();
        const icon = { problem: '⚠️', off: '⚪', ok: '✅' };
        const summary = list.length
            ? `<p class="arch-notice arch-notice-bad"><b>⚠️ ${list.length} problem${list.length === 1 ? '' : 's'} right now.</b></p>`
            : health ? '<p class="arch-notice arch-notice-good"><b>✅ Everything checked is working.</b></p>' : '<p>Checking…</p>';
        const server = healthError ? `<li class="arch-check arch-check-problem"><b>⚠️ OneTouch server</b><br>${esc(healthError)}<br><span class="arch-small">Noticed ${esc(when(healthErrorSince))}. These results are from the last answer.</span></li>` : '';
        return `
            <${Heading} class="arch-node-name">🩺 Is everything working?</${Heading}>
            ${summary}
            <ul class="arch-checks">${server}${checks.map(c => `
                <li class="arch-check arch-check-${esc(c.state)}">
                    <b>${icon[c.state] || ''} ${c.node ? `<button type="button" class="arch-link" data-node="${esc(c.node)}">${esc(c.name)}</button>` : esc(c.name)}</b><br>
                    ${esc(c.text)}
                    ${c.effect ? `<br><b>What this means:</b> ${esc(c.effect)}` : ''}
                    ${c.state === 'problem' && c.detail && c.detail !== c.text ? `<br><span class="arch-small">${esc(c.detail)}</span>` : ''}
                    <br><span class="arch-small">${c.since ? `Since ${esc(when(c.since))}. ` : ''}Checked ${esc(when(c.checkedAt))}.</span>
                </li>`).join('')}</ul>
            <p class="arch-small">Each check really tries the thing, while this page is open, every 30 seconds or so. Outside services are asked less often. ServiceNow's authentication is listed in the banner, and in its own tab.</p>`;
    }

    function pushStatusHtml() {
        const push = map.push;
        const s = map.servicenow;
        if (receiving()) {
            return `<span class="arch-chip arch-chip-good">🔓 Records arriving</span>
                <span class="arch-status-text"><b>ServiceNow live push:</b> ${push.heard.toLocaleString()} record${push.heard === 1 ? '' : 's'} since this server started, the last at ${esc(when(push.lastAt))}.</span>
                <button type="button" class="arch-btn" data-side="servicenow">Details</button>`;
        }
        return `<span class="arch-chip arch-chip-warn">🔒 Needs ServiceNow authentication</span>
            <span class="arch-status-text"><b>${esc(s.headline)}</b> No data can arrive until then.</span>
            <span class="arch-status-actions">
                <button type="button" class="arch-btn" data-side="servicenow">What it needs</button>
                <button type="button" class="arch-btn" data-flow="servicenow">▶ See how it will work</button>
            </span>`;
    }

    function railHtml() {
        if (railMin) {
            return `<button type="button" class="arch-rail-toggle" data-do="rail" aria-expanded="false" aria-label="Show the views and layers" title="Show the views and layers">▶<span class="arch-rail-toggle-text"> Views and layers</span></button>`;
        }
        const flows = map.flows.map(f => `<button type="button" class="arch-rail-btn${f.pending ? ' arch-rail-pending' : ''}${player.flow?.id === f.id ? ' is-on' : ''}"
                data-flow="${esc(f.id)}" aria-pressed="${player.flow?.id === f.id}">
                <span aria-hidden="true">${esc(f.icon)}</span> ${esc(f.name)}${f.pending && !receiving() ? ' <span class="arch-lock" title="Needs ServiceNow authentication">🔒</span>' : ''}</button>`).join('');
        const layers = map.layers.map(l => `<button type="button" class="arch-rail-btn${focusLayer === l.id ? ' is-on' : ''}" data-layer="${esc(l.id)}"
                aria-pressed="${focusLayer === l.id}" title="${esc(l.hint)}" style="--arch-c: ${colorVar(l.color)}">
                <span class="arch-swatch" aria-hidden="true"></span> ${esc(l.name)}</button>`).join('');
        return `
            <div class="arch-mode" role="group" aria-label="How to show the map">
                <button type="button" class="arch-btn${mode === '3d' ? ' is-on' : ''}" data-do="3d" aria-pressed="${mode === '3d'}"${world ? '' : ' disabled title="This browser can\'t draw 3D here"'}>🧊 3D</button>
                <button type="button" class="arch-btn${mode === 'list' ? ' is-on' : ''}" data-do="list" aria-pressed="${mode === 'list'}">📝 List</button>
                <button type="button" class="arch-btn" data-do="reset" title="Back to the whole map"${mode === '3d' && world ? '' : ' disabled'}>↺</button>
                <button type="button" class="arch-btn" data-do="rail" aria-expanded="true" aria-label="Hide the views and layers" title="Hide the views and layers">◀</button>
            </div>
            <h3 class="arch-rail-head">What happens when…</h3>
            <div class="arch-rail-group">${flows}</div>
            <h3 class="arch-rail-head">Layers</h3>
            <div class="arch-rail-group">${layers}</div>`;
    }

    // A time as this person reads it
    function when(iso) {
        const date = iso ? new Date(iso) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'not known';
    }

    // One block: what it is, how it's protected, what it talks to, where its code is
    function nodeHtml(node, Heading = 'h3') {
        const layer = layerById(node.layer);
        const facts = node.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
        const talks = map.links.filter(l => l.from === node.id || l.to === node.id).map(l => {
            const out = l.from === node.id;
            const other = nodeById(out ? l.to : l.from);
            return `<li><span class="arch-arrow" aria-label="${out ? 'To' : 'From'}">${out ? '→' : '←'}</span>
                <button type="button" class="arch-link" data-node="${esc(other.id)}">${esc(other.name)}</button>
                <span class="arch-link-note">${esc(l.label)}${l.kind === 'pending' && !receiving() ? ' (once authenticated)' : ''}</span></li>`;
        }).join('');
        const notice = node.pending && !receiving()
            ? `<p class="arch-notice">🔒 ${esc(map.servicenow.headline)} <button type="button" class="arch-link" data-side="servicenow">See what it needs</button></p>` : '';
        return `
            <div class="arch-node-head" style="--arch-c: ${colorVar(layer.color)}">
                <span class="arch-swatch" aria-hidden="true"></span>
                <span class="arch-node-layer">${esc(layer.name)}</span>
            </div>
            <${Heading} class="arch-node-name">${esc(node.name)}</${Heading}>
            <p class="arch-node-tech">${esc(node.tech)}${node.version ? ` · <b>${esc(node.version)}</b>` : ''}</p>
            ${notice}
            <p>${esc(node.what)}</p>
            ${facts ? `<dl class="arch-facts">${facts}</dl>` : ''}
            <h4>How it's protected</h4>
            <p>${esc(node.secure)}</p>
            ${talks ? `<h4>Connected to</h4><ul class="arch-talks">${talks}</ul>` : ''}
            <h4>In the code</h4>
            <ul class="arch-files">${node.files.map(f => `<li><code>${esc(f)}</code></li>`).join('')}</ul>`;
    }

    function stackHtml() {
        return map.stack.map(g => `
            <h4>${esc(g.group)}</h4>
            <table class="arch-stack"><tbody>${g.items.map(i => `
                <tr><th scope="row">${esc(i.name)}</th><td class="arch-stack-version">${esc(i.version || 'not known')}</td><td>${esc(i.role)}</td></tr>`).join('')}
            </tbody></table>`).join('');
    }

    // The push: what's built, what it can't do without ServiceNow, what's been heard
    function servicenowHtml(Heading = 'h3') {
        const s = map.servicenow;
        const push = map.push;
        const heard = receiving()
            ? `<p class="arch-notice arch-notice-good">🔓 <b>${push.heard.toLocaleString()} record${push.heard === 1 ? '' : 's'}</b> heard since this server started, the last at ${esc(when(push.lastAt))}${push.last ? ` (${esc(push.last)})` : ''}.</p>`
            : `<p class="arch-notice"><b>🔒 ${esc(s.headline)}</b></p>`;
        return `
            <${Heading} class="arch-node-name">🔌 ServiceNow live push</${Heading}>
            ${heard}
            <p>${esc(s.summary)}</p>
            <div class="arch-evidence">
                <div><span>Records heard</span><b>${push.heard.toLocaleString()}</b></div>
                <div><span>Since</span><b>${esc(when(push.since))}</b></div>
                <div><span>This server listening</span><b>${push.listening ? 'Yes' : 'Not right now'}</b></div>
            </div>
            <p class="arch-small">${esc(s.evidence)}</p>
            <h4>${receiving() ? 'What it depends on' : 'What it needs before it can work'}</h4>
            <ol class="arch-needs">${s.needs.map(n => `<li><b>${esc(n.title)}</b> ${esc(n.text)}</li>`).join('')}</ol>
            <p class="arch-small">${esc(s.direction)}</p>
            <h4>What's already built</h4>
            <ul class="arch-built">${s.built.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
            <h4>The steps for ServiceNow</h4>
            <p><code>${esc(s.blueprint)}</code></p>
            <button type="button" class="arch-btn arch-btn-wide" data-flow="servicenow">▶ See how it ${receiving() ? 'works' : 'will work'}</button>`;
    }

    function overviewHtml() {
        return `
            <h3 class="arch-node-name">How OneTouch fits together</h3>
            <p>${esc(map.overview)}</p>
            <h4>Find your way around</h4>
            <ul class="arch-built">
                <li>Click any block for what it does, how it's protected and where its code is.</li>
                <li>Pick a <b>What happens when…</b> to follow a real request through the system, step by step.</li>
                <li>Moving dots show which way data goes. They aren't live traffic.</li>
                <li>The dashed amber path is the ServiceNow live push. Nothing moves on it until ServiceNow is authenticated.</li>
            </ul>`;
    }

    function renderSide() {
        const side = $('arch-side');
        if (!side) return;
        const node = selected && nodeById(selected);
        const count = problems().length;
        const reported = issues?.openCount || 0;
        const tabs = [['details', '🧩 Details'], ['stack', '📚 Stack'], ['health', `🩺 Health${count ? ` (${count})` : ''}`],
            ['reports', `📣 Reports${reported ? ` (${reported})` : ''}`], ['servicenow', '🔌 ServiceNow']];
        // A redraw of the same tab stays where the person had scrolled to
        const scrolled = sideShown === sideTab ? side.querySelector('.arch-side-body')?.scrollTop || 0 : 0;
        const body = sideTab === 'health' ? healthHtml()
            : sideTab === 'reports' ? reportsHtml()
            : sideTab === 'stack' ? stackHtml()
            : sideTab === 'servicenow' ? servicenowHtml()
            : node ? nodeHtml(node) : overviewHtml();
        side.innerHTML = `
            <div class="arch-tabs" role="tablist" aria-label="Details">${tabs.map(([id, label]) => `
                <button type="button" role="tab" class="arch-tab${sideTab === id ? ' is-on' : ''}" aria-selected="${sideTab === id}" data-side="${id}">${label}</button>`).join('')}
            </div>
            <div class="arch-side-body" role="tabpanel" tabindex="0">${body}</div>`;
        side.querySelector('.arch-side-body').scrollTop = scrolled;
        sideShown = sideTab;
    }

    function renderStep() {
        const box = $('arch-step');
        if (!box) return;
        const flow = player.flow;
        box.hidden = !flow || mode !== '3d';
        if (box.hidden) return;
        const step = flow.steps[player.index];
        const chip = {
            needs: '<span class="arch-chip arch-chip-warn">Needs setting up in ServiceNow</span>',
            stop: '<span class="arch-chip arch-chip-stop">🔒 Needs ServiceNow authentication</span>',
            after: '<span class="arch-chip">Built. Runs once authenticated</span>',
        }[step.phase] || '';
        box.className = `arch-step${step.stop ? ' arch-step-stop' : ''}`;
        box.innerHTML = `
            <div class="arch-step-head">
                <span><span aria-hidden="true">${esc(flow.icon)}</span> <b>${esc(flow.name)}</b></span>
                <span class="arch-step-count">Step ${player.index + 1} of ${flow.steps.length}</span>
                <button type="button" class="arch-icon-btn" data-do="close" aria-label="Stop following this">✕</button>
            </div>
            ${chip}
            <h3>${esc(step.title)}</h3>
            <p>${esc(step.text)}</p>
            ${flow.pending ? `<p class="arch-small">An animation of how it ${receiving() ? 'works, not a live view' : 'will work. Nothing is sent to or from ServiceNow'}.</p>` : ''}
            <div class="arch-step-nav">
                <button type="button" class="arch-btn" data-do="back"${player.index ? '' : ' disabled'}>◀ Back</button>
                <button type="button" class="arch-btn" data-do="play" aria-pressed="${player.playing}">${player.playing ? '⏸ Pause' : '▶ Play'}</button>
                <button type="button" class="arch-btn" data-do="next"${player.index < flow.steps.length - 1 ? '' : ' disabled'}>Next ▶</button>
            </div>`;
    }

    function renderList() {
        const list = $('arch-list');
        if (!list) return;
        const note = world ? '' : '<p class="arch-notice">This browser can\'t draw the 3D map here, so here it is as a list.</p>';
        const flows = map.flows.map(f => `
            <article class="arch-item" id="arch-flow-${esc(f.id)}" tabindex="-1">
                <h4 class="arch-node-name"><span aria-hidden="true">${esc(f.icon)}</span> ${esc(f.name)}</h4>
                <ol class="arch-needs">${f.steps.map(s => `<li><b>${esc(s.title)}</b> ${esc(s.text)}</li>`).join('')}</ol>
            </article>`).join('');
        const layers = map.layers.map(l => {
            const nodes = map.nodes.filter(n => n.layer === l.id);
            return `<section class="arch-list-layer" id="arch-layer-${esc(l.id)}"><h3>${esc(l.name)}</h3><p class="arch-small">${esc(l.hint)}</p>
                ${nodes.map(n => `<article class="arch-item" id="arch-item-${esc(n.id)}" tabindex="-1">${nodeHtml(n, 'h4')}</article>`).join('')}</section>`;
        }).join('');
        list.innerHTML = `${note}
            <section class="arch-list-layer"><h2>🧊 Architecture</h2><p>${esc(map.overview)}</p></section>
            <section class="arch-list-layer arch-item" id="arch-list-health" tabindex="-1">${healthHtml('h3')}</section>
            <section class="arch-list-layer arch-item" id="arch-list-reports" tabindex="-1">${reportsHtml('h3')}</section>
            <section class="arch-list-layer arch-item" id="arch-list-servicenow" tabindex="-1">${servicenowHtml('h3')}</section>
            <section class="arch-list-layer"><h3>Tech stack</h3>${stackHtml()}</section>
            <section class="arch-list-layer"><h3>What happens when…</h3>${flows}</section>
            ${layers}`;
    }

    function setMode(next) {
        mode = next === '3d' && world ? '3d' : 'list';
        const root = $('architecture');
        root.classList.toggle('arch-is-list', mode === 'list');
        $('arch-stage').hidden = mode !== '3d';
        $('arch-list').hidden = mode !== 'list';
        if (mode === 'list') {
            stopFlow();
            world?.sleep();
            renderList();
        } else {
            world.resize();
            if (active) world.wake();
        }
        $('arch-rail').innerHTML = railHtml();
        renderStep();
    }

    // In the list, a button that would change the scene goes to that part instead
    function goToInList(id) {
        const el = $(id);
        if (!el) return;
        el.scrollIntoView({ block: 'start' });
        if (el.tabIndex >= 0) el.focus({ preventScroll: true });
    }

    // -----------------------------------------------------------------
    // What's picked: a block, a layer or a flow
    // -----------------------------------------------------------------

    function select(id, { fly = true } = {}) {
        selected = id;
        sideTab = 'details';
        renderSide();
        if (mode === 'list') {
            if (id) goToInList(`arch-item-${id}`);
            return;
        }
        if (player.flow) return;
        focusLayer = null;
        $('arch-rail').innerHTML = railHtml();
        world?.showFocus(fly);
    }

    function pickLayer(id) {
        focusLayer = focusLayer === id ? null : id;
        selected = null;
        if (player.flow) stopFlow();
        renderSide();
        $('arch-rail').innerHTML = railHtml();
        if (mode === 'list') {
            if (focusLayer) goToInList(`arch-layer-${focusLayer}`);
            return;
        }
        world?.showFocus(true);
    }

    function startFlow(id) {
        const flow = map.flows.find(f => f.id === id);
        if (!flow) return;
        if (mode === 'list') {
            goToInList(`arch-flow-${id}`);
            return;
        }
        selected = null;
        focusLayer = null;
        player.flow = flow;
        player.playing = !lessMotion();
        // The push's flow beside what it needs
        if (flow.pending) sideTab = 'servicenow';
        goToStep(0);
        renderSide();
        $('arch-rail').innerHTML = railHtml();
    }

    function goToStep(index) {
        const step = player.flow.steps[index];
        player.index = index;
        player.elapsed = 0;
        // Long enough to read it
        player.hold = Math.max(3500, 1800 + step.text.length * 42);
        // The gate is the point of this flow: the animation waits there
        if (step.stop) player.playing = false;
        // In this order: the camera leaves room for the card, so it needs its size
        renderStep();
        world?.playStep(step);
    }

    function stopFlow() {
        if (!player.flow) return;
        player.flow = null;
        player.playing = false;
        world?.endStep();
        renderStep();
    }

    function tickPlayer(ms) {
        if (!player.flow || !player.playing) return;
        player.elapsed += ms;
        if (player.elapsed < player.hold) return;
        if (player.index < player.flow.steps.length - 1) goToStep(player.index + 1);
        else { player.playing = false; renderStep(); }
    }

    // Every button on the page, in one place
    function onClick(event) {
        // A name over a block, or anything else that's a button on this page
        const el = event.target.closest('[data-issue], [data-node], [data-flow], [data-layer], [data-side], [data-do]');
        if (!el || !$('architecture').contains(el)) return;
        if (el.dataset.issue) {
            setIssue(el, el.dataset.issue, el.dataset.issueStatus);
        } else if (el.dataset.node) {
            if (player.flow) stopFlow();
            select(el.dataset.node);
        } else if (el.dataset.flow) {
            startFlow(el.dataset.flow);
        } else if (el.dataset.layer) {
            pickLayer(el.dataset.layer);
        } else if (el.dataset.side) {
            sideTab = el.dataset.side;
            renderSide();
            if (mode === 'list' && sideTab === 'servicenow') goToInList('arch-list-servicenow');
            if (mode === 'list' && sideTab === 'health') goToInList('arch-list-health');
            if (mode === 'list' && sideTab === 'reports') goToInList('arch-list-reports');
        } else {
            act(el.dataset.do);
        }
    }

    function act(what) {
        if (what === 'rail') setRailMin(!railMin);
        else if (what === '3d' || what === 'list') setMode(what);
        else if (what === 'reset') resetView();
        else if (what === 'close') { stopFlow(); $('arch-rail').innerHTML = railHtml(); world?.showFocus(true); }
        else if (what === 'back' && player.flow && player.index > 0) goToStep(player.index - 1);
        else if (what === 'next' && player.flow && player.index < player.flow.steps.length - 1) goToStep(player.index + 1);
        else if (what === 'play' && player.flow) {
            player.playing = !player.playing;
            // Play at the last step: from the start again
            if (player.playing && player.index === player.flow.steps.length - 1) goToStep(0);
            else renderStep();
        }
    }

    // The left side bar, in to the side and back; this browser remembers which
    function setRailMin(min) {
        railMin = min;
        try { localStorage.setItem(RAIL_KEY, min ? '1' : '0'); } catch { /* Just for this visit */ }
        paintRail();
        $('arch-rail').querySelector('[data-do="rail"]')?.focus();
    }
    function paintRail() {
        $('architecture').classList.toggle('arch-rail-min', railMin);
        $('arch-rail').classList.toggle('arch-rail-closed', railMin);
        $('arch-rail').innerHTML = railHtml();
        if (mode === '3d') world?.resize();
    }

    function resetView() {
        selected = null;
        focusLayer = null;
        stopFlow();
        renderSide();
        $('arch-rail').innerHTML = railHtml();
        world?.home();
    }

    // -----------------------------------------------------------------
    // The push's status, while the page is open
    // -----------------------------------------------------------------

    function paintPush(before) {
        const status = $('arch-status');
        if (!status || !map) return;
        const list = problems();
        const key = `${map.push.state}:${map.push.heard}:${list.map(p => `${p.id}=${p.text}`).join('|')}:${issues?.openCount || 0}:${issues?.open[0]?.id || 0}`;
        if (status.dataset.key !== key) {
            status.dataset.key = key;
            status.innerHTML = statusHtml();
            status.classList.toggle('arch-status-good', receiving() && !list.length);
            status.classList.toggle('arch-status-bad', list.length > 0);
            // The banner's height may have changed, and the scene is centered below it
            if (mode === '3d') world?.resize();
            world?.setProblems(list.map(p => p.node).filter(Boolean));
        }
        world?.setPushState(receiving());
        if (before !== undefined && map.push.heard > before) world?.pulse(map.servicenow.arrives);
    }

    async function fetchMap() {
        const response = await fetch(`${API_BASE}/api/architecture`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'The map could not be loaded right now.');
        return data;
    }

    // The health report. Not getting one is itself a problem to report: a server
    // that can't reach its database, or isn't answering, can't say so any other way.
    async function pollHealth() {
        if (!active || !map) return;
        const session = opening;
        const before = JSON.stringify(health?.checks.map(c => [c.id, c.state, c.text])) + healthError;
        try {
            const response = await fetch(`${API_BASE}/api/architecture/health`, { headers: authHeaders() });
            if (handleUnauthorized(response) || session !== opening) return;
            const data = await response.json().catch(() => ({}));
            if (session !== opening) return;
            if (!response.ok) throw new Error(data.error || `The server answered with an error (${response.status}).`);
            health = data;
            healthError = null;
            healthErrorSince = null;
        } catch (error) {
            if (session !== opening) return;
            healthError = error instanceof TypeError ? 'This page can\'t reach the server.' : error.message;
            healthErrorSince ||= new Date().toISOString();
        }
        paintPush();
        if (before !== JSON.stringify(health?.checks.map(c => [c.id, c.state, c.text])) + healthError) {
            renderSide();
            if (mode === 'list') renderList();
        } else if (sideTab === 'health' && !$('arch-side')?.contains(document.activeElement)) {
            // Only the "Checked at" times moved: not worth taking the keys from someone
            renderSide();
        }
    }

    // What people have reported. If this fails, the health report says why.
    async function pollIssues() {
        if (!active || !map) return;
        const session = opening;
        try {
            const response = await fetch(`${API_BASE}/api/architecture/issues`, { headers: authHeaders() });
            if (handleUnauthorized(response) || !response.ok) return;
            const data = await response.json();
            if (session !== opening || !map) return;
            const changed = JSON.stringify(data) !== JSON.stringify(issues);
            issues = data;
            if (!changed) return;
            paintPush();
            renderSide();
            if (mode === 'list') renderList();
        } catch { /* Tried again shortly */ }
    }

    // Resolved, or back on the list
    async function setIssue(button, id, status) {
        button.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/api/architecture/issues/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ status }),
            });
            if (handleUnauthorized(response)) return;
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'That could not be changed right now.');
            await pollIssues();
            // The button has gone with its report: the keys go to the list it was in
            document.querySelector('.arch-side-body')?.focus({ preventScroll: true });
        } catch (error) {
            button.disabled = false;
            showToast(`❌ ${error.message}`);
        }
    }

    async function pollPush() {
        pollHealth();
        pollIssues();
        if (!active || !map) return;
        const session = opening;
        try {
            const response = await fetch(`${API_BASE}/api/architecture/push`, { headers: authHeaders() });
            if (handleUnauthorized(response) || !response.ok) return;
            const push = await response.json();
            if (session !== opening || !map) return;
            const before = map.push.heard;
            // The first record ever heard: what the map says about the push moves on with it
            if (push.state !== map.push.state) {
                const fresh = await fetchMap();
                if (!fresh || session !== opening || !map) return;
                stopFlow();
                map = fresh;
                $('arch-rail').innerHTML = railHtml();
                if (mode === 'list') renderList();
            } else {
                map.push = push;
            }
            paintPush(before);
            if (map.push.heard !== before) renderSide();
        } catch { /* Tried again shortly */ }
    }

    // -----------------------------------------------------------------
    // Opening, leaving, signing out (app.js: switchTab, signOut)
    // -----------------------------------------------------------------

    function showArchitecture() {
        active = true;
        clearInterval(pollTimer);
        pollTimer = setInterval(pollPush, POLL_MS);
        if (loading) return; // It wakes the scene itself when it's ready
        if (map) {
            pollPush();
            if (mode === '3d') world?.wake();
            return;
        }
        loading = openMap().finally(() => { loading = null; });
    }

    async function openMap() {
        const session = ++opening;
        const root = $('architecture');
        root.innerHTML = '<p class="arch-message">Loading the map…</p>';
        try {
            const data = await fetchMap();
            if (!data) return;
            if (session !== opening) return;
            map = data;
        } catch (error) {
            if (session === opening) root.innerHTML = `<p class="arch-message">${esc(error.message)}</p>`;
            return;
        }
        root.innerHTML = pageHtml();
        root.onclick = onClick;
        let THREE = null;
        try {
            THREE = await import(THREE_URL);
        } catch (error) {
            console.error('🧊 Could not load three.js:', error);
        }
        if (session !== opening) return;
        if (THREE) {
            try {
                world = buildWorld(THREE);
            } catch (error) {
                console.error('🧊 Could not start the 3D map:', error);
                world = null;
            }
        }
        renderSide();
        paintRail();
        paintPush();
        setMode(world ? '3d' : 'list');
        pollHealth();
        pollIssues();
    }

    function hideArchitecture() {
        if (!active) return;
        active = false;
        clearInterval(pollTimer);
        pollTimer = null;
        player.playing = false;
        renderStep();
        world?.sleep();
    }

    // Signed out: nothing of the map stays in this browser's memory
    function resetArchitecture() {
        hideArchitecture();
        opening++;
        world?.dispose();
        world = null;
        map = null;
        health = null;
        healthError = null;
        healthErrorSince = null;
        issues = null;
        sideShown = null;
        mode = '3d';
        sideTab = 'details';
        selected = null;
        focusLayer = null;
        player.flow = null;
        const root = $('architecture');
        if (root) {
            root.innerHTML = '';
            root.onclick = null;
            root.classList.remove('arch-is-list');
        }
    }

    // -----------------------------------------------------------------
    // The 3D scene
    // -----------------------------------------------------------------

    function buildWorld(THREE) {
        const stage = $('arch-stage');
        const canvas = $('arch-canvas');
        const tagsBox = $('arch-tags');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
        const size = { w: 1, h: 1 };
        const clock = { last: performance.now(), t: 0 };
        let raf = null;
        let dirty = true;

        // ---- Colors: every one comes from style.css, so each person's scheme applies ----

        const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        function cssColor(name, target = new THREE.Color()) {
            const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
            probe.clearRect(0, 0, 1, 1);
            probe.fillStyle = '#000';
            probe.fillStyle = value || '#888';
            probe.fillRect(0, 0, 1, 1);
            const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
            return target.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        }
        const paints = [];
        function paint(material, css, mix = null, share = 0) {
            const entry = { material, css, mix, share };
            paints.push(entry);
            return entry;
        }
        const mixColor = new THREE.Color();
        function applyTheme() {
            for (const p of paints) {
                cssColor(p.css, p.material.color);
                if (p.mix) p.material.color.lerp(cssColor(p.mix, mixColor), p.share);
                if (p.material.emissive) p.material.emissive.copy(p.material.color);
            }
            for (const link of links) {
                cssColor(link.base, link.baseColor);
                cssColor('accent', link.hotColor);
                link.paintedAt = -1;
            }
            cssColor('accent', packetColor);
            if (flowPacket) flowPacket.mesh.material.color.copy(packetColor);
            dirty = true;
        }
        const packetColor = new THREE.Color();

        // ---- Light ----

        scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.7));
        const sun = new THREE.DirectionalLight(0xffffff, 2.1);
        sun.position.set(18, 42, 26);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
        sun.shadow.bias = -0.0015;
        scene.add(sun);

        // ---- Shapes ----

        function roundedBox(w, h, d, r = 0.2) {
            const s = new THREE.Shape();
            s.moveTo(-w / 2 + r, -d / 2);
            s.lineTo(w / 2 - r, -d / 2);
            s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
            s.lineTo(w / 2, d / 2 - r);
            s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
            s.lineTo(-w / 2 + r, d / 2);
            s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
            s.lineTo(-w / 2, -d / 2 + r);
            s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
            const bevel = Math.min(0.07, h / 4);
            const geometry = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
            geometry.rotateX(-Math.PI / 2);
            geometry.translate(0, bevel, 0);
            return geometry;
        }

        // A block's parts. mats: every material, so a block dims and glows as one.
        function makeParts(color) {
            const group = new THREE.Group();
            const mats = [];
            const solid = (css = color, mix = null, share = 0, options = {}) => {
                const { emissiveIntensity: glowBase = 0, ...rest } = options;
                const material = new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.12, transparent: true, emissiveIntensity: glowBase, ...rest });
                material.userData.base = options.opacity ?? 1;
                material.userData.glowBase = glowBase;
                paint(material, css, mix, share);
                mats.push(material);
                return material;
            };
            const add = (geometry, material, x = 0, y = 0, z = 0) => {
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(x, y, z);
                mesh.castShadow = true;
                group.add(mesh);
                return mesh;
            };
            return { group, mats, solid, add };
        }

        // Each returns its parts plus height (for the name above it) and center (for its links)
        const SHAPES = {
            module(p) {
                p.add(roundedBox(3, 0.95, 2), p.solid());
                p.add(roundedBox(2.5, 0.08, 1.5, 0.14), p.solid(undefined, 'panel-bg', 0.45), 0, 0.95, 0);
                return { height: 1.05, center: 0.5 };
            },
            server(p) {
                const body = p.solid();
                const light = p.solid('panel-bg', null, 0, { emissiveIntensity: 0.4 });
                for (let i = 0; i < 3; i++) {
                    const y = i * 0.76;
                    p.add(roundedBox(5.4, 0.64, 3.6, 0.26), body, 0, y, 0);
                    for (let d = 0; d < 3; d++) p.add(new THREE.BoxGeometry(0.28, 0.1, 0.05), light, -2.1 + d * 0.42, y + 0.34, 1.82);
                }
                return { height: 2.25, center: 1.1 };
            },
            screen(p) {
                const screen = new THREE.Group();
                const add = (geometry, material, x, y, z) => {
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(x, y, z);
                    mesh.castShadow = true;
                    screen.add(mesh);
                };
                const flat = (w, h, d, r) => {
                    const g = roundedBox(w, d, h, r);
                    g.rotateX(Math.PI / 2);
                    return g;
                };
                add(flat(7, 4.2, 0.28, 0.3), p.solid(), 0, 2.2, 0);
                add(flat(6.5, 3.2, 0.06, 0.14), p.solid('panel-bg'), 0, 1.98, 0.34);
                const dots = p.solid('panel-bg', null, 0);
                for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.09, 12, 12), dots, -3 + i * 0.3, 3.95, 0.32);
                const bars = p.solid(undefined, 'panel-bg', 0.35);
                [[-1.5, 2.8, 2.6], [-0.9, 2.2, 3.8], [-1.8, 1.6, 2], [1.6, 2.8, 2], [1.2, 1.6, 2.8], [-0.4, 1, 4.8]].forEach(([x, y, w]) => add(new THREE.BoxGeometry(w, 0.26, 0.05), bars, x, y, 0.42));
                screen.rotation.x = -0.14;
                p.group.add(screen);
                return { height: 4.4, center: 2.2 };
            },
            ring(p) {
                const outer = p.add(new THREE.TorusGeometry(2.4, 0.36, 18, 64), p.solid(), 0, 0.72, 0);
                outer.rotation.x = Math.PI / 2;
                const inner = p.add(new THREE.TorusGeometry(1.5, 0.1, 12, 48), p.solid(undefined, 'panel-bg', 0.45), 0, 0.72, 0);
                inner.rotation.x = Math.PI / 2;
                return { height: 1.2, center: 0.72 };
            },
            cube(p) {
                const body = p.add(new THREE.BoxGeometry(2.7, 2.7, 2.7), p.solid(), 0, 1.75, 0);
                body.rotation.set(0.3, Math.PI / 4, 0.2);
                const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ transparent: true }));
                edges.material.userData.base = 0.85;
                paint(edges.material, 'panel-bg');
                p.mats.push(edges.material);
                edges.position.copy(body.position);
                edges.rotation.copy(body.rotation);
                p.group.add(edges);
                return { height: 3.7, center: 1.75 };
            },
            bars(p) {
                p.add(roundedBox(4.8, 0.2, 2.8, 0.2), p.solid(undefined, 'panel-bg', 0.45));
                const bars = p.solid();
                [1.3, 2.5, 1.8, 3.1].forEach((h, i) => p.add(new THREE.BoxGeometry(0.82, h, 0.82), bars, -1.55 + i * 1.03, 0.2 + h / 2, 0));
                return { height: 3.4, center: 1.4 };
            },
            db(p) {
                const body = p.solid();
                const rim = p.solid(undefined, 'panel-bg', 0.5);
                for (let i = 0; i < 3; i++) {
                    const y = 0.36 + i * 0.88;
                    p.add(new THREE.CylinderGeometry(2.25, 2.25, 0.72, 48), body, 0, y, 0);
                    p.add(new THREE.TorusGeometry(2.25, 0.035, 8, 64), rim, 0, y + 0.36, 0).rotation.x = Math.PI / 2;
                }
                return { height: 2.75, center: 1.3 };
            },
            sheets(p) {
                const paper = p.solid();
                for (let i = 0; i < 4; i++) p.add(roundedBox(2.6, 0.12, 2, 0.08), paper, 0, 0.14 * i, 0).rotation.y = (i - 1.5) * 0.08;
                return { height: 0.72, center: 0.3 };
            },
            orb(p) {
                p.add(new THREE.IcosahedronGeometry(1.8, 1), p.solid(undefined, null, 0, { flatShading: true }), 0, 0, 0);
                const shell = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.35, 1)), new THREE.LineBasicMaterial({ transparent: true }));
                shell.material.userData.base = 0.4;
                paint(shell.material, 'muted');
                p.mats.push(shell.material);
                p.group.add(shell);
                return { height: 2.5, center: 0, spin: shell };
            },
            listener(p) {
                p.add(roundedBox(3.9, 1.5, 2.8, 0.26), p.solid());
                p.add(roundedBox(3.2, 0.1, 2.1, 0.16), p.solid(undefined, 'panel-bg', 0.4), 0, 1.5, 0);
                return { height: 1.65, center: 0.75 };
            },
            gate(p, node) {
                const frame = new THREE.Group();
                const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.26, 18, 64), p.solid('warn', null, 0, { emissiveIntensity: 0.35 }));
                const inner = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.05, 10, 56), p.solid('warn', 'panel-bg', 0.35));
                const lock = new THREE.Group();
                // A closed padlock: the shackle's two ends both go into the body
                const lockBody = new THREE.Mesh(roundedBox(1.15, 0.36, 0.92, 0.12), p.solid('warn'));
                lockBody.rotation.x = Math.PI / 2;
                lockBody.position.set(0, -0.14, -0.18);
                const shackleMaterial = p.solid('warn', 'panel-bg', 0.2);
                const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.09, 12, 28, Math.PI), shackleMaterial);
                shackle.position.y = 0.42;
                const leg = new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12);
                const legLeft = new THREE.Mesh(leg, shackleMaterial);
                legLeft.position.set(-0.34, 0.34, 0);
                const legRight = new THREE.Mesh(leg, shackleMaterial);
                legRight.position.set(0.34, 0.34, 0);
                lock.add(lockBody, shackle, legLeft, legRight);
                frame.add(hoop, inner, lock);
                frame.traverse(o => { if (o.isMesh) o.castShadow = true; });
                // Facing the way the call comes in
                const [a, b] = node.data.between.map(id => nodeById(id).pos);
                frame.rotation.y = Math.atan2(a[0] - b[0], a[2] - b[2]);
                p.group.add(frame);
                node.lock = lock;
                // The name sits well above the hoop, clear of its neighbours' names
                return { height: 4.1, center: 0 };
            },
        };

        // ---- The floors, and the frame of what Docker Compose runs ----

        const plates = [];
        for (const layer of map.layers) {
            if (layer.y === null || !layer.plate) continue;
            const [px, pz] = layer.plate;
            const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2, roughness: 0.9, depthWrite: false });
            paint(material, layer.color, 'panel-bg', 0.45);
            const mesh = new THREE.Mesh(roundedBox(px * 2, 0.14, pz * 2, 0.6), material);
            mesh.position.set(0, layer.y - 0.14, 0);
            mesh.receiveShadow = true;
            const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(px * 2, 0.01, pz * 2)), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }));
            paint(line.material, layer.color);
            line.position.set(0, layer.y, 0);
            scene.add(mesh, line);
            plates.push({ layer, mesh, line, dim: 1, dimTo: 1 });
        }
        {
            const { min, max } = map.compose;
            const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
            const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineDashedMaterial({ dashSize: 0.5, gapSize: 0.32, transparent: true, opacity: 0.6 }));
            frame.computeLineDistances();
            frame.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
            paint(frame.material, 'muted');
            scene.add(frame);
            const grid = new THREE.GridHelper(120, 60);
            grid.position.y = min[1] - 0.2;
            grid.material.transparent = true;
            grid.material.opacity = 0.5;
            grid.material.vertexColors = false;
            paint(grid.material, 'border');
            scene.add(grid);
        }

        // ---- The blocks ----

        const nodes = new Map();
        const pickable = [];
        for (const data of map.nodes) {
            const parts = makeParts(layerById(data.layer).color);
            const node = { data, mats: parts.mats, group: parts.group, dim: 1, dimTo: 1, glow: 0, glowTo: 0 };
            const shape = (SHAPES[data.shape] || SHAPES.module)(parts, node);
            node.group.position.set(...data.pos);
            node.center = new THREE.Vector3(...data.pos).add(new THREE.Vector3(0, shape.center, 0));
            node.top = new THREE.Vector3(...data.pos).add(new THREE.Vector3(0, shape.height + 0.15, 0));
            node.spin = shape.spin || null;
            node.group.traverse(o => {
                if (o.isMesh) {
                    o.userData.node = data.id;
                    pickable.push(o);
                }
            });
            scene.add(node.group);
            nodes.set(data.id, node);
        }

        // ---- The links ----

        function dashTexture() {
            const c = document.createElement('canvas');
            c.width = 16;
            c.height = 2;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, 16, 2);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 9, 2);
            const texture = new THREE.CanvasTexture(c);
            texture.wrapS = THREE.RepeatWrapping;
            return texture;
        }

        function curveBetween(a, b, bend = 0) {
            const from = a.center.clone();
            const to = b.center.clone();
            const mid = from.clone().lerp(to, 0.5);
            if (Math.abs(from.y - to.y) < 1.2) mid.y += Math.min(2.4, from.distanceTo(to) * 0.16);
            else {
                mid.x += bend;
                mid.z += bend * 0.4;
            }
            return new THREE.QuadraticBezierCurve3(from, mid, to);
        }

        const links = [];
        const sphere = new THREE.SphereGeometry(1, 16, 16);
        for (const data of map.links) {
            const a = nodes.get(data.from);
            const b = nodes.get(data.to);
            const curve = curveBetween(a, b, data.bend);
            const pending = data.kind === 'pending';
            const radius = data.kind === 'inner' ? 0.035 : pending ? 0.085 : 0.06;
            const geometry = new THREE.TubeGeometry(curve, Math.max(24, Math.round(curve.getLength() * 3)), radius, 8, false);
            const material = new THREE.MeshBasicMaterial({ transparent: true });
            if (pending) {
                material.alphaMap = dashTexture();
                material.alphaMap.repeat.x = Math.max(4, Math.round(curve.getLength() / 1.1));
                material.alphaTest = 0.5;
            }
            const mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
            const link = {
                data, a, b, curve, mesh, material, pending,
                base: pending ? 'warn' : data.kind === 'inner' ? 'faint' : 'muted',
                baseColor: new THREE.Color(), hotColor: new THREE.Color(),
                opacity: data.kind === 'inner' ? 0.7 : 0.85,
                dim: 1, dimTo: 1, hot: 0, hotTo: 0, paintedAt: -1, packet: null,
            };
            // A dot along each link in use, never on the push: nothing moves there yet
            if (data.kind === 'main') {
                const packetMaterial = new THREE.MeshBasicMaterial({ transparent: true });
                const packet = new THREE.Mesh(sphere, packetMaterial);
                packet.scale.setScalar(0.13);
                scene.add(packet);
                link.packet = { mesh: packet, material: packetMaterial, u: Math.random() };
            }
            links.push(link);
        }
        const linkBetween = (x, y) => links.find(l => (l.data.from === x && l.data.to === y) || (l.data.from === y && l.data.to === x));

        // ---- The dot that follows a request ----

        function glowTexture() {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255,255,255,0.95)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 64, 64);
            return new THREE.CanvasTexture(c);
        }
        const glow = glowTexture();
        function makeTraveller() {
            const material = new THREE.MeshBasicMaterial({ transparent: true });
            const mesh = new THREE.Mesh(sphere, material);
            mesh.scale.setScalar(0.34);
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, opacity: 0.85 }));
            halo.scale.setScalar(5.5);
            mesh.add(halo);
            mesh.visible = false;
            scene.add(mesh);
            return { mesh, halo, points: [], lengths: [], total: 0, at: 0, speed: 11 };
        }
        const flowPacket = makeTraveller();
        const pulses = [];

        // A path of blocks as points along their links
        function pathPoints(path) {
            const points = [];
            if (path.length === 1) return [nodes.get(path[0]).center.clone()];
            for (let i = 0; i < path.length - 1; i++) {
                const link = linkBetween(path[i], path[i + 1]);
                const part = link
                    ? link.curve.getPoints(Math.max(16, Math.round(link.curve.getLength() * 2)))
                    : [nodes.get(path[i]).center.clone(), nodes.get(path[i + 1]).center.clone()];
                if (link && link.data.from !== path[i]) part.reverse();
                points.push(...(i ? part.slice(1) : part));
            }
            return points;
        }
        function setRoute(traveller, points) {
            traveller.points = points;
            traveller.lengths = [0];
            for (let i = 1; i < points.length; i++) traveller.lengths[i] = traveller.lengths[i - 1] + points[i].distanceTo(points[i - 1]);
            traveller.total = traveller.lengths[points.length - 1] || 0;
            traveller.at = 0;
        }
        function placeTraveller(traveller) {
            const { points, lengths, total } = traveller;
            if (!points.length) return;
            if (points.length === 1 || !total) {
                traveller.mesh.position.copy(points[0]);
                return;
            }
            const at = Math.min(traveller.at, total);
            let i = 1;
            while (i < lengths.length - 1 && lengths[i] < at) i++;
            const span = lengths[i] - lengths[i - 1] || 1;
            traveller.mesh.position.lerpVectors(points[i - 1], points[i], (at - lengths[i - 1]) / span);
        }

        // ---- Names over the blocks: real buttons, so keys and screen readers reach them ----

        const tags = [];
        let gate = null;
        function addTag(el, anchor, rank, node = null) {
            tagsBox.append(el);
            const tag = { el, anchor, rank, node, boost: 0, off: false, w: 0, h: 0, x: 0, y: 0, z: 0 };
            tags.push(tag);
            return tag;
        }
        for (const node of nodes.values()) {
            const data = node.data;
            const el = document.createElement('button');
            el.type = 'button';
            el.dataset.node = data.id;
            const isGate = data.shape === 'gate';
            el.className = `arch-tag${data.big ? ' arch-tag-big' : ''}${isGate ? ' arch-tag-gate' : ''}`;
            el.style.setProperty('--arch-c', colorVar(layerById(data.layer).color));
            const sub = isGate ? '' : data.version || (data.big ? data.tech : '');
            el.innerHTML = `<span class="arch-tag-name"></span>${sub ? `<span class="arch-tag-sub">${esc(sub)}</span>` : ''}`;
            el.firstChild.textContent = data.name;
            node.tag = addTag(el, node.top, isGate ? 12 : data.pending ? 8 : data.big ? 6 : 3, node);
            if (isGate) gate = node;
            el.addEventListener('focus', () => { node.tag.boost = 20; dirty = true; });
            el.addEventListener('blur', () => { node.tag.boost = 0; dirty = true; });
            el.addEventListener('pointerenter', () => { hoverNode(data.id); });
            el.addEventListener('pointerleave', () => { hoverNode(null); });
        }
        for (const plate of plates) {
            const el = document.createElement('span');
            el.className = 'arch-layer-tag';
            el.style.setProperty('--arch-c', colorVar(plate.layer.color));
            el.textContent = plate.layer.name;
            const [px, pz] = plate.layer.plate;
            plate.tag = addTag(el, new THREE.Vector3(-px + 0.3, plate.layer.y, pz), 1);
        }
        {
            const { min, max } = map.compose;
            const el = document.createElement('span');
            el.className = 'arch-layer-tag arch-frame-tag';
            el.textContent = map.compose.name;
            el.title = map.compose.note;
            addTag(el, new THREE.Vector3(max[0] - 3, max[1], min[2]), 2);
        }

        function measureTags() {
            for (const tag of tags) {
                tag.w = tag.el.offsetWidth;
                tag.h = tag.el.offsetHeight;
            }
        }

        const projected = new THREE.Vector3();
        function placeTags() {
            for (const tag of tags) {
                projected.copy(tag.anchor).project(camera);
                tag.x = (projected.x + 1) / 2 * size.w;
                tag.y = (1 - projected.y) / 2 * size.h;
                tag.z = projected.z;
            }
            // The important ones keep their place; one that would cover them fades away
            const order = [...tags].sort((a, b) => (b.rank + b.boost) - (a.rank + a.boost) || a.z - b.z);
            const placed = [];
            for (const tag of order) {
                // A block's name stays whole at the edge of the view; a floor's only shows whole
                const half = tag.w / 2;
                const outside = tag.z > 1 || tag.y < 0 || tag.y - tag.h > size.h
                    || (tag.node ? tag.x < 0 || tag.x > size.w : tag.x - half < 0 || tag.x + half > size.w);
                if (tag.node && !outside) tag.x = Math.min(Math.max(tag.x, half + 4), Math.max(half + 4, size.w - half - 4));
                const x0 = tag.x - half, x1 = tag.x + half, y0 = tag.y - tag.h - 2, y1 = tag.y + 2;
                const covered = placed.some(p => x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0);
                const off = outside || (covered && tag.boost < 20);
                if (!off) placed.push({ x0, x1, y0, y1 });
                if (off !== tag.off) {
                    tag.off = off;
                    tag.el.classList.toggle('arch-tag-off', off);
                }
                tag.el.style.transform = `translate(${tag.x.toFixed(1)}px, ${tag.y.toFixed(1)}px) translate(-50%, -100%)`;
            }
        }

        // ---- The camera: drag, wheel, pinch and keys all move the goal, and it eases there ----

        const SCENE_CENTER = new THREE.Vector3(3, 12.6, 0);
        const SCENE_HALF = { w: 21.5, h: 16.2 };
        const HOME = { theta: 0.2, phi: 1.2 };
        const orbit = { ...HOME, radius: 90, target: SCENE_CENTER.clone() };
        const goal = { ...HOME, radius: 90, target: SCENE_CENTER.clone() };
        let touched = false; // once someone moves it, it stays where they put it

        function homeRadius() {
            const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const insets = freeArea();
            const aspect = Math.max(0.4, insets.w / Math.max(1, insets.h));
            const scale = size.h / Math.max(1, insets.h);
            return Math.max(SCENE_HALF.h / tan, SCENE_HALF.w / (tan * aspect)) * scale + 3;
        }
        const clampGoal = () => {
            goal.phi = THREE.MathUtils.clamp(goal.phi, 0.25, Math.PI / 2 + 0.25);
            goal.radius = THREE.MathUtils.clamp(goal.radius, 12, 240);
        };

        // The part of the canvas no panel is floating over
        function freeArea() {
            const root = $('architecture');
            const stacked = getComputedStyle($('arch-rail')).position !== 'absolute';
            const rect = root.getBoundingClientRect();
            if (stacked) return { w: size.w, h: size.h, left: 0, right: 0, top: 0, bottom: 0 };
            const left = $('arch-rail').getBoundingClientRect().right - rect.left;
            const right = rect.right - $('arch-side').getBoundingClientRect().left;
            const top = $('arch-status').getBoundingClientRect().bottom - rect.top;
            const bottom = 26;
            return { w: size.w - left - right, h: size.h - top - bottom, left, right, top, bottom };
        }

        function resize() {
            const w = stage.clientWidth, h = stage.clientHeight;
            if (!w || !h) return;
            size.w = w;
            size.h = h;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            const free = freeArea();
            // Centers the scene in the part that shows
            camera.setViewOffset(w, h, (free.right - free.left) / 2, (free.bottom - free.top) / 2, w, h);
            camera.updateProjectionMatrix();
            measureTags();
            if (!touched) {
                goal.radius = homeRadius();
                orbit.radius = goal.radius;
            }
            dirty = true;
        }

        function applyCamera() {
            const s = Math.sin(orbit.phi);
            camera.position.set(
                orbit.target.x + orbit.radius * s * Math.sin(orbit.theta),
                orbit.target.y + orbit.radius * Math.cos(orbit.phi),
                orbit.target.z + orbit.radius * s * Math.cos(orbit.theta));
            camera.lookAt(orbit.target);
        }

        // Frames some blocks, names included, in the part of the view that shows
        // (above a step's card, when there is one)
        function frameBlocks(ids, minimum = 24, cardHeight = 0) {
            const box = new THREE.Box3();
            for (const id of ids) {
                box.expandByPoint(nodes.get(id).center);
                box.expandByPoint(nodes.get(id).top);
            }
            const middle = box.getCenter(new THREE.Vector3());
            const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
            const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const free = freeArea();
            const roomHigh = Math.max(80, free.h - cardHeight) / size.h;
            const roomWide = free.w / size.h;
            const fit = Math.max((half.y + 3) / (tan * roomHigh), (Math.hypot(half.x, half.z) + 4.5) / (tan * roomWide));
            goal.radius = Math.min(homeRadius(), Math.max(minimum, fit));
            goal.target.copy(middle);
            goal.target.y -= goal.radius * tan * cardHeight / size.h;
            touched = true;
        }

        function home() {
            touched = false;
            goal.theta = HOME.theta;
            goal.phi = HOME.phi;
            goal.target.copy(SCENE_CENTER);
            goal.radius = homeRadius();
            showFocus(false);
            dirty = true;
        }

        // ---- Mouse, touch and keys ----

        const pointers = new Map();
        const ray = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let press = null;
        let pinch = 0;
        let hovered = null;

        function blockAt(x, y) {
            const rect = canvas.getBoundingClientRect();
            ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
            ray.setFromCamera(ndc, camera);
            const hit = ray.intersectObjects(pickable, false)[0];
            return hit ? hit.object.userData.node : null;
        }

        function hoverNode(id) {
            if (hovered === id) return;
            hovered = id;
            canvas.style.cursor = id ? 'pointer' : '';
            showFocus(false);
        }

        function panBy(dx, dy) {
            const scale = 2 * orbit.radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / size.h;
            const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
            const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
            goal.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
        }

        canvas.addEventListener('pointerdown', e => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            canvas.setPointerCapture(e.pointerId);
            press = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button !== 0 };
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = Math.hypot(a.x - b.x, a.y - b.y);
            }
            stage.focus({ preventScroll: true });
        });
        canvas.addEventListener('pointermove', e => {
            const known = pointers.get(e.pointerId);
            if (!known) {
                hoverNode(blockAt(e.clientX, e.clientY));
                return;
            }
            const dx = e.clientX - known.x, dy = e.clientY - known.y;
            known.x = e.clientX;
            known.y = e.clientY;
            if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.moved = true;
            if (!press?.moved) return;
            touched = true;
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const distance = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinch) goal.radius *= pinch / Math.max(1, distance);
                pinch = distance;
                panBy(dx / 2, dy / 2);
            } else if (press.pan) {
                panBy(dx, dy);
            } else {
                goal.theta -= dx * 0.0062;
                goal.phi -= dy * 0.0062;
            }
            clampGoal();
            dirty = true;
        });
        function endPress(e) {
            const wasClick = press && !press.moved && pointers.size === 1 && e.type === 'pointerup';
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinch = 0;
            if (wasClick) {
                const id = blockAt(e.clientX, e.clientY);
                if (id) {
                    if (player.flow) stopFlow();
                    select(id);
                } else if (selected || focusLayer) {
                    selected = null;
                    focusLayer = null;
                    renderSide();
                    $('arch-rail').innerHTML = railHtml();
                    showFocus(false);
                }
            }
            if (!pointers.size) press = null;
        }
        canvas.addEventListener('pointerup', endPress);
        canvas.addEventListener('pointercancel', endPress);
        canvas.addEventListener('pointerleave', () => { if (!pointers.size) hoverNode(null); });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            touched = true;
            goal.radius *= Math.exp(e.deltaY * 0.0011);
            clampGoal();
            dirty = true;
        }, { passive: false });

        stage.addEventListener('keydown', e => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const moves = { ArrowLeft: () => { goal.theta -= 0.14; }, ArrowRight: () => { goal.theta += 0.14; },
                ArrowUp: () => { goal.phi -= 0.1; }, ArrowDown: () => { goal.phi += 0.1; },
                '+': () => { goal.radius *= 0.88; }, '=': () => { goal.radius *= 0.88; }, '-': () => { goal.radius *= 1.14; } };
            if (moves[e.key]) {
                e.preventDefault();
                touched = true;
                moves[e.key]();
                clampGoal();
                dirty = true;
            } else if (e.key === '0') {
                e.preventDefault();
                resetView();
            } else if (e.key === 'Escape') {
                if (player.flow) act('close');
                else if (selected || focusLayer) resetView();
            }
        });

        // ---- What's in focus ----

        // Whatever is picked decides what stays bright: a step of a flow, a
        // selected block and its neighbours, or a layer. Hovering only lights.
        let stepFocus = null;
        function showFocus(fly) {
            let bright = null;
            let brightLinks = null;
            const lit = new Set();
            if (stepFocus) {
                bright = new Set([...stepFocus.path, ...stepFocus.around]);
                brightLinks = new Set([...stepFocus.links, ...stepFocus.aroundLinks]);
                stepFocus.path.forEach(id => lit.add(id));
            } else if (selected) {
                bright = new Set([selected]);
                brightLinks = new Set();
                lit.add(selected);
                for (const link of links) {
                    if (link.data.from === selected || link.data.to === selected) {
                        brightLinks.add(link);
                        bright.add(link.data.from);
                        bright.add(link.data.to);
                    }
                }
            } else if (focusLayer) {
                bright = new Set(map.nodes.filter(n => n.layer === focusLayer).map(n => n.id));
                brightLinks = new Set(links.filter(l => bright.has(l.data.from) && bright.has(l.data.to)));
            }
            for (const [id, node] of nodes) {
                node.dimTo = !bright || bright.has(id) ? 1 : DIM;
                node.glowTo = lit.has(id) ? 0.34 : hovered === id ? 0.24 : 0;
                node.tag.el.classList.toggle('arch-tag-dim', node.dimTo < 1 && hovered !== id);
                node.tag.el.classList.toggle('arch-tag-on', lit.has(id) || hovered === id);
                node.tag.boost = lit.has(id) || hovered === id ? 20 : node.tag.el === document.activeElement ? 20 : bright?.has(id) ? 6 : 0;
            }
            for (const link of links) {
                const touchesHover = hovered && (link.data.from === hovered || link.data.to === hovered);
                link.dimTo = !brightLinks || brightLinks.has(link) || touchesHover ? 1 : DIM * 0.7;
                const isLit = stepFocus ? stepFocus.links.includes(link) : selected ? brightLinks.has(link) : touchesHover;
                link.hotTo = isLit ? 1 : 0;
            }
            for (const plate of plates) {
                plate.dimTo = focusLayer && plate.layer.id !== focusLayer ? 0.2 : bright ? 0.5 : 1;
            }
            if (fly) {
                if (stepFocus) {
                    // With what's either side of it, for a step that stands between two
                    // blocks; and clear of the card, when that floats over the scene
                    const card = freeArea().left ? $('arch-step').offsetHeight + 26 : 0;
                    frameBlocks([...stepFocus.path, ...stepFocus.around], 30, card);
                } else if (selected) frameBlocks([...bright], 30);
                else if (focusLayer) frameBlocks(map.nodes.filter(n => n.layer === focusLayer).map(n => n.id), 34);
                else if (touched) { goal.target.copy(SCENE_CENTER); goal.radius = homeRadius(); }
                clampGoal();
            }
            dirty = true;
        }

        function playStep(step) {
            lastTouch = performance.now();
            const path = step.path;
            const stepLinks = [];
            for (let i = 0; i < path.length - 1; i++) {
                const link = linkBetween(path[i], path[i + 1]);
                if (link) stepLinks.push(link);
            }
            const around = step.around || [];
            stepFocus = {
                path, links: stepLinks, stop: Boolean(step.stop), around,
                aroundLinks: around.map(id => linkBetween(id, path[0])).filter(Boolean),
            };
            // A step that stops: the dot comes up to the block from the side it's on, and no further
            const stoppedAt = nodes.get(path[0]).center;
            const from = step.stop && nodes.get(around[around.length - 1]).center;
            setRoute(flowPacket, step.stop
                ? [from.clone().lerp(stoppedAt, 0.72), stoppedAt.clone().lerp(from, 0.1)]
                : pathPoints(path));
            flowPacket.mesh.visible = true;
            flowPacket.mesh.material.color.copy(packetColor);
            flowPacket.halo.material.color.copy(packetColor);
            if (lessMotion()) flowPacket.at = flowPacket.total;
            placeTraveller(flowPacket);
            showFocus(true);
        }

        function endStep() {
            stepFocus = null;
            flowPacket.mesh.visible = false;
            showFocus(false);
        }

        // A real record just arrived: one dot, along the way it really went
        function pulse(path) {
            if (lessMotion() || mode !== '3d') return;
            const traveller = makeTraveller();
            traveller.mesh.material.color.copy(packetColor);
            traveller.halo.material.color.copy(packetColor);
            traveller.mesh.visible = true;
            setRoute(traveller, pathPoints(path));
            pulses.push(traveller);
            wake();
        }

        // Green instead of amber, and no lock, once records really arrive
        let pushOpen = null;
        function setPushState(open) {
            if (open === pushOpen) return;
            pushOpen = open;
            const color = open ? 'series-3' : 'warn';
            const parts = new Set([...nodes.values()].filter(n => n.data.pending).flatMap(n => n.mats));
            for (const entry of paints) {
                if (entry.material.isMeshStandardMaterial && parts.has(entry.material)) entry.css = color;
            }
            for (const link of links) if (link.pending) link.base = color;
            if (gate.lock) gate.lock.visible = !open;
            gate.tag.el.classList.toggle('arch-tag-open', open);
            gate.tag.el.firstChild.textContent = open ? '🔓 Records arriving' : '🔒 Needs ServiceNow authentication';
            gate.tag.w = gate.tag.el.offsetWidth;
            gate.tag.h = gate.tag.el.offsetHeight;
            applyTheme();
        }

        // ---- Each frame ----

        const ease = (value, to, rate, dt) => value + (to - value) * (1 - Math.exp(-rate * dt));
        const close = (a, b, gap = 0.001) => Math.abs(a - b) < gap;

        // Keeping it light. Without a graphics card a browser draws all this on
        // the CPU, and OneTouch's server can be the same computer, so the
        // decoration (the dots, the turning, the breathing gate) never runs on
        // regardless: it stops when nobody has touched the map for a while, it's
        // limited to 30 frames a second, and if frames are slow it stops for good
        // and only what someone asks for is drawn.
        const IDLE_MS = 2 * 60 * 1000;
        const SLOW_FRAME_MS = 70;
        const FRAME_MS = 1000 / 30;
        let lastTouch = performance.now();
        let lastDrawn = 0;
        let slowFor = 0;
        let lowPower = false;
        function noteTouch() { lastTouch = performance.now(); dirty = true; }
        stage.addEventListener('pointerdown', noteTouch);
        stage.addEventListener('pointermove', noteTouch);
        stage.addEventListener('wheel', noteTouch, { passive: true });
        stage.addEventListener('keydown', noteTouch);

        // Slow frames for 3 seconds in a row: no decoration from here on, no
        // shadows, and fewer pixels. Asked-for movement still works.
        function watchSpeed(ms) {
            if (lowPower) return;
            slowFor = ms > SLOW_FRAME_MS ? slowFor + ms : 0;
            if (slowFor < 3000) return;
            lowPower = true;
            console.warn('🧊 Frames are slow here, so the map stops its decoration to keep the computer free');
            sun.castShadow = false;
            renderer.setPixelRatio(1);
            resize();
        }

        function frame(now) {
            raf = requestAnimationFrame(frame);
            // The browser's own pace, not how often something changed: slowly moving
            // the mouse isn't a slow computer. Only while drawing, not after a long gap.
            const gap = now - clock.last;
            if (now - lastDrawn < 200 && gap < 1000) watchSpeed(gap);
            const dt = Math.min(0.05, gap / 1000);
            clock.last = now;
            clock.t += dt;
            const still = lessMotion();
            tickPlayer(dt * 1000);
            // The decoration: only while someone is here, on a computer that keeps up
            const lively = !still && !lowPower && now - lastTouch < IDLE_MS;

            // Turns slowly by itself until someone takes hold of it
            if (!touched && lively && !selected && !focusLayer && !stepFocus && !hovered) goal.theta += dt * 0.035;

            const rate = still ? 1000 : 5;
            let moving = false;
            for (const key of ['theta', 'phi', 'radius']) {
                orbit[key] = ease(orbit[key], goal[key], rate, dt || 0.016);
                if (!close(orbit[key], goal[key], key === 'radius' ? 0.01 : 0.0004)) moving = true;
            }
            orbit.target.lerp(goal.target, 1 - Math.exp(-rate * (dt || 0.016)));
            if (orbit.target.distanceToSquared(goal.target) > 0.0001) moving = true;
            if (moving) dirty = true;
            applyCamera();

            // Blocks and links fade and glow towards where they should be
            for (const node of nodes.values()) {
                const wasDim = node.dim, wasGlow = node.glow;
                node.dim = ease(node.dim, node.dimTo, still ? 1000 : 7, dt || 0.016);
                let glowTo = node.glowTo;
                // The gate keeps breathing while it's what everything waits for
                if (node === gate && !receiving() && lively) glowTo += 0.14 + 0.14 * Math.sin(clock.t * 2.4);
                if (node === gate && stepFocus?.stop && lively) glowTo += 0.3 * Math.abs(Math.sin(clock.t * 6));
                node.glow = ease(node.glow, glowTo, still ? 1000 : 9, dt || 0.016);
                if (!close(wasDim, node.dim) || !close(wasGlow, node.glow)) {
                    dirty = true;
                    for (const material of node.mats) {
                        material.opacity = (material.userData.base ?? 1) * node.dim;
                        if (material.emissive) material.emissiveIntensity = (material.userData.glowBase || 0) + node.glow;
                    }
                }
                if (node.spin && lively) {
                    node.spin.rotation.y += dt * 0.25;
                    dirty = true;
                }
            }
            for (const link of links) {
                const wasDim = link.dim, wasHot = link.hot;
                link.dim = ease(link.dim, link.dimTo, still ? 1000 : 7, dt || 0.016);
                link.hot = ease(link.hot, link.hotTo, still ? 1000 : 7, dt || 0.016);
                if (!close(wasDim, link.dim) || !close(wasHot, link.hot) || link.paintedAt < 0) {
                    dirty = true;
                    link.paintedAt = 1;
                    link.material.opacity = link.opacity * link.dim;
                    link.material.color.lerpColors(link.baseColor, link.hotColor, link.hot);
                }
                if (link.packet) {
                    const show = lively && !stepFocus && link.dim > 0.5;
                    if (link.packet.mesh.visible !== show) dirty = true;
                    link.packet.mesh.visible = show;
                    if (show) {
                        link.packet.u = (link.packet.u + dt * (2.6 / Math.max(3, link.curve.getLength()))) % 1;
                        link.curve.getPoint(link.packet.u, link.packet.mesh.position);
                        link.packet.material.color.copy(packetColor);
                        link.packet.material.opacity = Math.min(1, Math.sin(link.packet.u * Math.PI) * 3) * 0.95;
                        dirty = true;
                    }
                }
            }
            for (const plate of plates) {
                const was = plate.dim;
                plate.dim = ease(plate.dim, plate.dimTo, still ? 1000 : 7, dt || 0.016);
                if (!close(was, plate.dim)) {
                    plate.mesh.material.opacity = 0.2 * plate.dim;
                    plate.line.material.opacity = 0.55 * plate.dim;
                    plate.tag.el.classList.toggle('arch-tag-dim', plate.dim < 0.6);
                    dirty = true;
                }
            }

            // The dot following a request
            if (flowPacket.mesh.visible) {
                if (stepFocus?.stop && lively) {
                    // Knocks at the gate, and doesn't get through
                    flowPacket.at = flowPacket.total * (0.5 + 0.5 * Math.sin(clock.t * 5));
                    dirty = true;
                } else if (!still && flowPacket.total && flowPacket.at < flowPacket.total) {
                    flowPacket.at += dt * flowPacket.speed;
                    dirty = true;
                }
                placeTraveller(flowPacket);
            }
            for (let i = pulses.length - 1; i >= 0; i--) {
                const traveller = pulses[i];
                traveller.at += dt * traveller.speed;
                placeTraveller(traveller);
                dirty = true;
                if (traveller.at >= traveller.total) {
                    scene.remove(traveller.mesh);
                    traveller.mesh.material.dispose();
                    traveller.halo.material.dispose();
                    pulses.splice(i, 1);
                }
            }

            // At most 30 frames a second, and nothing at all when nothing has changed
            if (dirty && now - lastDrawn >= FRAME_MS - 1) {
                lastDrawn = now;
                renderer.render(scene, camera);
                placeTags();
                dirty = false;
            }
        }

        function wake() {
            if (raf !== null) return;
            clock.last = performance.now();
            lastTouch = clock.last;
            lastDrawn = 0;
            dirty = true;
            raf = requestAnimationFrame(frame);
        }
        function sleep() {
            if (raf !== null) cancelAnimationFrame(raf);
            raf = null;
        }

        // ---- Colors, size and the end ----

        const themeWatch = new MutationObserver(() => {
            applyTheme();
            measureTags();
        });
        themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-header', 'class', 'style'] });
        const sizeWatch = new ResizeObserver(resize);
        sizeWatch.observe(stage);

        // The browser took the 3D away (too many open, or a GPU reset): the list has it all
        function onContextLost(event) {
            event.preventDefault();
            console.error('🧊 The browser dropped the 3D map');
            dispose();
            world = null;
            stopFlow();
            setMode('list');
        }
        canvas.addEventListener('webglcontextlost', onContextLost);

        function dispose() {
            // First: forceContextLoss below would otherwise look like the browser dropping it
            canvas.removeEventListener('webglcontextlost', onContextLost);
            sleep();
            themeWatch.disconnect();
            sizeWatch.disconnect();
            scene.traverse(o => {
                o.geometry?.dispose();
                if (o.material) {
                    o.material.alphaMap?.dispose();
                    o.material.dispose();
                }
            });
            glow.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
        }

        applyTheme();
        resize();
        applyCamera();
        showFocus(false);

        // Blocks with a problem get a red name, which stays showing
        function setProblems(ids) {
            for (const [id, node] of nodes) {
                const bad = ids.includes(id);
                node.tag.el.classList.toggle('arch-tag-bad', bad);
                node.tag.baseRank ??= node.tag.rank;
                node.tag.rank = bad ? 15 : node.tag.baseRank;
            }
            dirty = true;
        }

        return { resize, wake, sleep, dispose, home, showFocus, playStep, endStep, pulse, setPushState, setProblems };
    }

    window.showArchitecture = showArchitecture;
    window.hideArchitecture = hideArchitecture;
    window.resetArchitecture = resetArchitecture;
    // From a 🔔 about a report (notifications.js): the page, on its reports
    window.showArchitectureReports = () => {
        sideTab = 'reports';
        switchTab('architecture');
        if (!map || loading) return;
        renderSide();
        if (mode === 'list') goToInList('arch-list-reports');
    };
})();
