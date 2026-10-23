// =====================================================================
// CHARTS: the charts people build themselves (their own dashboards, and
// Home), drawn as plain SVG in the page's colors, so they follow each
// person's color scheme. Thin marks, a hairline grid, a tooltip on every
// mark (hover or keyboard focus), and a table view for every chart.
// The numbers come from /api/charts/data (charts.mjs on the server).
// Loaded before app.js, whose helpers (escapeHtml, API_BASE, ...) these
// functions use when they run.
// =====================================================================

const DONUT_SLICES = 6; // part-to-whole reads at a glance only up to about six
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// What the builder offers and how each ticket type is named (from /api/charts/catalog)
let chartCatalog = null;
let chartCatalogLoading = null;
function loadChartCatalog() {
    if (chartCatalog) return Promise.resolve(chartCatalog);
    if (!chartCatalogLoading) {
        chartCatalogLoading = (async () => {
            const response = await fetch(`${API_BASE}/api/charts/catalog`, { headers: authHeaders() });
            if (handleUnauthorized(response)) return null;
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
            chartCatalog = data;
            return data;
        })().finally(() => { chartCatalogLoading = null; });
    }
    return chartCatalogLoading;
}

// ---------------------------------------------------------------------
// Words: titles, descriptions and labels people read
// ---------------------------------------------------------------------

const isTimeField = field => /_(day|week|month)$/.test(field || '');

function fieldLabel(source, field) {
    const src = chartCatalog?.sources[source];
    const pair = src && [...src.fields, ...src.times].find(([key]) => key === field);
    return pair ? pair[1] : field;
}

// "Team" -> "team", but "System (CI)" -> "system (CI)" and "SLA breached" stays
const lowerFirst = text => text.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());

// The Monday of an ISO week: 2026, 27 -> Jun 29, 2026
function isoWeekMonday(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
    return monday;
}

// '2026-07' -> 'Jul 2026', '2026-07-05' -> 'Jul 5', '2026-W27' -> 'Jun 29' (its Monday).
// long: the tooltip's fuller version.
function periodLabel(field, value, long = false) {
    let m;
    if ((m = String(value).match(/^(\d{4})-W(\d{2})$/))) {
        const d = isoWeekMonday(Number(m[1]), Number(m[2]));
        const day = `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
        return long ? `Week of ${day}, ${d.getUTCFullYear()}` : day;
    }
    if ((m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
        const day = `${SHORT_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
        return long ? `${day}, ${m[1]}` : day;
    }
    if ((m = String(value).match(/^(\d{4})-(\d{2})$/))) return `${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    return String(value);
}

function groupLabel(chart, value, long = false) {
    if (value === null || value === undefined) return '(Not set)';
    if (isTimeField(chart.groupBy)) return periodLabel(chart.groupBy, value, long);
    if (value === 'true') return 'Yes';
    if (value === 'false') return 'No';
    return String(value);
}

// "Open incidents by priority", "Requests by catalog item", "Closed changes"
function chartAutoTitle(chart) {
    const src = chartCatalog?.sources[chart.source];
    if (!src) return 'Chart';
    const what = chart.status === 'open' ? `Open ${src.many}` : chart.status === 'closed' ? `Closed ${src.many}` : src.label;
    if (!chart.groupBy || chart.display === 'number') return what;
    return `${what} by ${lowerFirst(fieldLabel(chart.source, chart.groupBy))}`;
}

function chartTitle(chart) {
    return chart.title || chartAutoTitle(chart);
}

const fmtDay = day => periodLabel('x_day', day, true);

// Which tickets a chart counts, in words: "Open only · Priority: P1 - Critical · Opened Aug 3 – Sep 1, 2026"
function chartDescription(chart) {
    const src = chartCatalog?.sources[chart.source];
    const parts = [];
    if (chart.status === 'open') parts.push(`Open ${src ? src.many : ''} only (${src ? src.openStates.join(', ') : ''})`);
    if (chart.status === 'closed') parts.push(`Closed ${src ? src.many : ''} only`);
    for (const f of chart.filters || []) {
        const shown = f.values.slice(0, 3).map(v => groupLabel({ groupBy: f.field }, v)).join(', ');
        parts.push(`${fieldLabel(chart.source, f.field)}: ${shown}${f.values.length > 3 ? ` and ${f.values.length - 3} more` : ''}`);
    }
    const dates = chart.dates || { preset: 'all' };
    if (dates.preset === 'custom' && (dates.from || dates.to)) {
        parts.push(dates.from && dates.to ? `Opened ${fmtDay(dates.from)} to ${fmtDay(dates.to)}`
            : dates.from ? `Opened on or after ${fmtDay(dates.from)}` : `Opened on or before ${fmtDay(dates.to)}`);
    } else if (dates.preset !== 'all' && dates.preset !== 'custom') {
        parts.push(`Opened in the data's last ${dates.preset} days`);
    }
    return parts.length ? parts.join(' · ') : `All ${src ? src.many : 'tickets'}`;
}

// 0 / 950 / 1.2K / 12K / 1.5M
function compactNumber(n) {
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
    return String(n);
}

// ---------------------------------------------------------------------
// Data: one request per distinct question, kept for the page's life
// (the data is a frozen export, so an answer never changes)
// ---------------------------------------------------------------------

const chartDataCache = new Map();

// What changes the numbers; how it looks (display, color, size) doesn't
function chartDataKey(chart) {
    const { source, status, dates, filters, groupBy, limit, sort } = chart;
    return JSON.stringify({ source, status, dates, filters, groupBy, limit, sort });
}

function fetchChartData(chart) {
    const key = chartDataKey(chart);
    if (!chartDataCache.has(key)) {
        const pending = (async () => {
            const response = await fetch(`${API_BASE}/api/charts/data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ chart }),
            });
            if (handleUnauthorized(response)) return null;
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
            return data;
        })();
        chartDataCache.set(key, pending);
        pending.then(data => { if (!data) chartDataCache.delete(key); }, () => chartDataCache.delete(key));
        if (chartDataCache.size > 300) chartDataCache.delete(chartDataCache.keys().next().value);
    }
    return chartDataCache.get(key);
}

// ---------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------

const measureContext = document.createElement('canvas').getContext('2d');
function textWidth(text, size = 12, weight = 400) {
    measureContext.font = `${weight} ${size}px ${CHART_FONT}`;
    return measureContext.measureText(String(text)).width;
}

// The text, cut with "…" so it fits in `width` (labels never overflow their space)
function fitText(text, width, size = 12) {
    text = String(text);
    if (textWidth(text, size) <= width) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(`${text.slice(0, mid)}…`, size) <= width) lo = mid; else hi = mid - 1;
    }
    return lo ? `${text.slice(0, lo)}…` : '';
}

// Round axis steps (1, 2, 5 x 10^n), from zero to just above the biggest value
function niceScale(max, target = 4) {
    if (max <= 0) return { top: 1, ticks: [0, 1] };
    const rough = max / target;
    const power = 10 ** Math.floor(Math.log10(rough));
    const n = rough / power;
    const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return { top, ticks };
}

// A single-series chart's color: the person's accent, or one of the chart colors
function seriesColor(chart) {
    return chart.color && chart.color !== 'accent' ? `var(--series-${chart.color})` : 'var(--accent)';
}

const r1 = n => Math.round(n * 10) / 10;

// A column with a rounded top and a square foot on the baseline
function columnPath(x, top, w, h, radius = 4) {
    const r = Math.min(radius, w / 2, h);
    return `M${r1(x)},${r1(top + h)}V${r1(top + r)}Q${r1(x)},${r1(top)} ${r1(x + r)},${r1(top)}H${r1(x + w - r)}` +
        `Q${r1(x + w)},${r1(top)} ${r1(x + w)},${r1(top + r)}V${r1(top + h)}Z`;
}
// A sideways bar with a rounded end
function barPath(x, y, w, h, radius = 4) {
    const r = Math.min(radius, h / 2, w);
    return `M${r1(x)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h - r)}` +
        `Q${r1(x + w)},${r1(y + h)} ${r1(x + w - r)},${r1(y + h)}H${r1(x)}Z`;
}

// A mark's tooltip, as attributes (shown on hover and keyboard focus)
function tipAttrs(chart, row, total) {
    const share = total ? ` (${((row.count / total) * 100).toFixed(1)}%)` : '';
    return ` data-tip-value="${escapeHtml(row.count.toLocaleString() + share)}" data-tip-label="${escapeHtml(row.label || groupLabel(chart, row.value, true))}"`;
}

function svgOpen(width, height, label) {
    return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">`;
}

// Hairline gridlines with their values at the left
function gridHtml(ticks, y, left, right) {
    return ticks.map(t => `<line class="chart-grid" x1="${left}" x2="${right}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>` +
        `<text class="chart-tick" x="${left - 6}" y="${r1(y(t) + 4)}" text-anchor="end">${compactNumber(t)}</text>`).join('');
}

// Labels along the bottom: as many as fit, evenly spaced, each cut to its room
function xLabelsHtml(chart, rows, xAt, room, baseY) {
    const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(room.total / 72))));
    return rows.map((row, i) => i % every ? '' :
        `<text class="chart-tick" x="${r1(xAt(i))}" y="${baseY}" text-anchor="middle">${escapeHtml(fitText(groupLabel(chart, row.value), room.each * every - 6, 11))}</text>`).join('');
}

// ---------------------------------------------------------------------
// The chart forms
// ---------------------------------------------------------------------

function chartHeight(chart) {
    return chart.size === 'small' ? 200 : 260;
}

// One number: the total
function numberHtml(chart, data) {
    const src = chartCatalog?.sources[chart.source];
    const noun = src ? (data.total === 1 ? src.one : src.many) : 'tickets';
    const state = chart.status === 'open' ? 'open ' : chart.status === 'closed' ? 'closed ' : '';
    return `<div class="chart-stat"><span class="chart-stat-value">${data.total.toLocaleString()}</span>` +
        `<span class="chart-stat-label">${escapeHtml(state + noun)}</span></div>`;
}

// Columns: categories or periods along the bottom
function columnsHtml(chart, data, width) {
    const rows = data.rows;
    const height = chartHeight(chart);
    const { top, ticks } = niceScale(Math.max(...rows.map(r => r.count)));
    const m = { top: 20, right: 8, bottom: 26, left: Math.ceil(Math.max(...ticks.map(t => textWidth(compactNumber(t), 11)))) + 12 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const band = plotW / rows.length;
    const barW = Math.max(2, Math.min(24, band * 0.7));
    const y = v => m.top + plotH - (v / top) * plotH;
    const max = Math.max(...rows.map(r => r.count));
    // Values on the caps when they fit; otherwise only the biggest is labeled
    const labelAll = rows.length <= 12 && rows.every(r => textWidth(r.count.toLocaleString(), 11) <= band + 2);
    const focusable = rows.length <= 40 ? ' tabindex="0"' : '';
    let html = svgOpen(width, height, chartTitle(chart)) + gridHtml(ticks, y, m.left, width - m.right);
    rows.forEach((row, i) => {
        const x = m.left + i * band + (band - barW) / 2;
        const h = y(0) - y(row.count);
        if (h > 0) html += `<path class="chart-mark" d="${columnPath(x, y(row.count), barW, h)}" style="fill:${seriesColor(chart)}"/>`;
        if (labelAll || (row.count === max && i === rows.findIndex(r => r.count === max))) {
            html += `<text class="chart-value" x="${r1(x + barW / 2)}" y="${r1(y(row.count) - 6)}" text-anchor="middle">${row.count.toLocaleString()}</text>`;
        }
        html += `<rect class="chart-hit" x="${r1(m.left + i * band)}" y="${m.top}" width="${r1(band)}" height="${plotH}"${focusable}${tipAttrs(chart, row, data.total)}/>`;
    });
    html += `<line class="chart-axis" x1="${m.left}" x2="${width - m.right}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`;
    html += xLabelsHtml(chart, rows, i => m.left + i * band + band / 2, { total: plotW, each: band }, height - 8);
    return html + '</svg>';
}

// Sideways bars: long category names read best this way
function barsHtml(chart, data, width) {
    const rows = data.rows;
    const rowH = 28, barH = 16;
    const labels = rows.map(r => groupLabel(chart, r.value));
    const labelW = Math.min(width * 0.4, Math.max(...labels.map(l => textWidth(l, 12))) + 4);
    const valueW = Math.max(...rows.map(r => textWidth(r.count.toLocaleString(), 11))) + 10;
    const left = labelW + 10;
    const plotW = Math.max(20, width - left - valueW);
    const height = rows.length * rowH + 4;
    const max = Math.max(...rows.map(r => r.count)) || 1;
    let html = svgOpen(width, height, chartTitle(chart));
    rows.forEach((row, i) => {
        const y = i * rowH + (rowH - barH) / 2;
        const w = (row.count / max) * plotW;
        html += `<text class="chart-label" x="${r1(labelW)}" y="${r1(y + barH / 2 + 4)}" text-anchor="end">${escapeHtml(fitText(labels[i], labelW, 12))}</text>`;
        if (w > 0) html += `<path class="chart-mark" d="${barPath(left, y, w, barH)}" style="fill:${seriesColor(chart)}"/>`;
        html += `<text class="chart-value" x="${r1(left + w + 6)}" y="${r1(y + barH / 2 + 4)}">${row.count.toLocaleString()}</text>`;
        html += `<rect class="chart-hit" x="0" y="${i * rowH}" width="${width}" height="${rowH}" tabindex="0"${tipAttrs(chart, row, data.total)}/>`;
    });
    html += `<line class="chart-axis" x1="${left}" x2="${left}" y1="0" y2="${height}"/>`;
    return html + '</svg>';
}

// A line (or a line over a light wash, for "area"): best over time.
// The pointer (or arrow keys) moves a crosshair from point to point.
function lineHtml(chart, data, width, area) {
    const rows = data.rows;
    const height = chartHeight(chart);
    const { top, ticks } = niceScale(Math.max(...rows.map(r => r.count)));
    const m = { top: 22, right: 14, bottom: 26, left: Math.ceil(Math.max(...ticks.map(t => textWidth(compactNumber(t), 11)))) + 12 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const step = rows.length > 1 ? plotW / (rows.length - 1) : 0;
    const x = i => rows.length > 1 ? m.left + i * step : m.left + plotW / 2;
    const y = v => m.top + plotH - (v / top) * plotH;
    const color = seriesColor(chart);
    const points = rows.map((r, i) => `${r1(x(i))},${r1(y(r.count))}`);
    let html = svgOpen(width, height, chartTitle(chart)) + gridHtml(ticks, y, m.left, width - m.right);
    if (area && rows.length > 1) {
        html += `<path class="chart-area" d="M${points.join('L')}L${r1(x(rows.length - 1))},${r1(y(0))}L${r1(x(0))},${r1(y(0))}Z" style="fill:${color}"/>`;
    }
    html += `<line class="chart-axis" x1="${m.left}" x2="${width - m.right}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`;
    if (rows.length > 1) html += `<path class="chart-line" d="M${points.join('L')}" style="stroke:${color}"/>`;
    // Labeled: the peak and the latest value (not every point)
    const last = rows.length - 1;
    const peak = rows.reduce((best, r, i) => r.count > rows[best].count ? i : best, 0);
    for (const i of new Set([peak, last])) {
        const anchor = i === last ? 'end' : i === 0 ? 'start' : 'middle';
        html += `<text class="chart-value" x="${r1(i === last ? x(i) + 4 : x(i))}" y="${r1(y(rows[i].count) - 9)}" text-anchor="${anchor}">${rows[i].count.toLocaleString()}</text>`;
    }
    html += `<circle class="chart-dot" cx="${r1(x(last))}" cy="${r1(y(rows[last].count))}" r="4" style="fill:${color}"/>`;
    html += xLabelsHtml(chart, rows, x, { total: plotW, each: Math.max(step, 1) }, height - 8);
    // The crosshair, moved by the pointer or the arrow keys
    html += `<line class="chart-cross" x1="0" x2="0" y1="${m.top}" y2="${r1(y(0))}" visibility="hidden"/>` +
        `<circle class="chart-dot chart-cross-dot" r="4" visibility="hidden" style="fill:${color}"/>` +
        `<rect class="chart-hit line-hit" x="${m.left - 6}" y="${m.top}" width="${plotW + 12}" height="${plotH}" tabindex="0"` +
        ` aria-label="Move along the line with the arrow keys" data-left="${m.left}" data-step="${r1(step)}" data-plot-h="${plotH}" data-top="${m.top}" data-max="${top}"/>`;
    return html + '</svg>';
}

// Donut: share of the whole, at most six slices (the rest folds into "Other")
function donutHtml(chart, data, width) {
    let parts = data.rows.map((r, i) => ({ ...r, label: groupLabel(chart, r.value), slot: i + 1 }));
    let otherCount = data.other?.count || 0;
    let otherGroups = data.other?.groups || 0;
    if (parts.length + (otherCount ? 1 : 0) > DONUT_SLICES) {
        const folded = parts.slice(DONUT_SLICES - 1);
        parts = parts.slice(0, DONUT_SLICES - 1);
        otherCount += folded.reduce((s, r) => s + r.count, 0);
        otherGroups += folded.length;
    }
    if (otherCount) parts.push({ value: '__other', label: `Other (${otherGroups.toLocaleString()})`, count: otherCount, other: true });
    const total = data.total || 1;
    const side = width >= 440;
    const size = Math.min(side ? 190 : 170, side ? width * 0.42 : width - 20);
    const r = size / 2, inner = r * 0.62, cx = r + 2, cy = r + 2;
    const fill = p => p.other ? 'var(--chart-other)' : `var(--series-${p.slot})`;
    let angle = -Math.PI / 2;
    let slices = '';
    for (const p of parts) {
        const sweep = (p.count / total) * Math.PI * 2;
        if (sweep <= 0) continue;
        const tip = tipAttrs(chart, p, data.total);
        if (sweep >= Math.PI * 2 - 1e-6) {
            // One slice is everything: a full ring
            slices += `<path class="chart-mark slice" tabindex="0" d="M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z M${cx},${cy - inner}A${inner},${inner} 0 1 0 ${cx + 0.01},${cy - inner}Z" fill-rule="evenodd" style="fill:${fill(p)}"${tip}/>`;
            break;
        }
        const a0 = angle, a1 = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const pt = (rad, a) => `${r1(cx + rad * Math.cos(a))},${r1(cy + rad * Math.sin(a))}`;
        slices += `<path class="chart-mark slice" tabindex="0" d="M${pt(r, a0)}A${r1(r)},${r1(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${r1(inner)},${r1(inner)} 0 ${large} 0 ${pt(inner, a0)}Z" style="fill:${fill(p)}"${tip}/>`;
        angle = a1;
    }
    const src = chartCatalog?.sources[chart.source];
    const svg = `<svg class="chart-svg donut" width="${size + 4}" height="${size + 4}" viewBox="0 0 ${size + 4} ${size + 4}" role="img" aria-label="${escapeHtml(chartTitle(chart))}">` +
        slices +
        `<text class="chart-donut-total" x="${cx}" y="${cy + 2}" text-anchor="middle">${data.total < 100000 ? data.total.toLocaleString() : compactNumber(data.total)}</text>` +
        `<text class="chart-tick" x="${cx}" y="${cy + 18}" text-anchor="middle">${escapeHtml(src ? src.many : 'tickets')}</text></svg>`;
    // The legend names every slice, with its number and share
    const legend = parts.map(p => `<li><span class="legend-key" style="background:${fill(p)}"></span>` +
        `<span class="legend-name" title="${escapeHtml(p.label)}">${escapeHtml(p.label)}</span>` +
        `<span class="legend-value">${p.count.toLocaleString()}</span>` +
        `<span class="legend-share">${((p.count / total) * 100).toFixed(1)}%</span></li>`).join('');
    return `<div class="chart-donut${side ? ' side' : ''}">${svg}<ul class="chart-legend">${legend}</ul></div>`;
}

// The table view: every chart has one (and "Table" charts are only this)
function chartTableHtml(chart, data) {
    const label = chart.groupBy ? fieldLabel(chart.source, chart.groupBy) : 'Tickets';
    const total = data.total || 1;
    const rows = data.rows.map(r => `<tr><td>${escapeHtml(groupLabel(chart, r.value, true))}</td>` +
        `<td class="num">${r.count.toLocaleString()}</td><td class="num">${((r.count / total) * 100).toFixed(1)}%</td></tr>`);
    if (data.other) {
        rows.push(`<tr class="chart-other-row"><td>Other (${data.other.groups.toLocaleString()} more)</td>` +
            `<td class="num">${data.other.count.toLocaleString()}</td><td class="num">${((data.other.count / total) * 100).toFixed(1)}%</td></tr>`);
    }
    const exportId = registerExport({
        title: chartTitle(chart),
        question: chartDescription(chart),
        tables: [{
            title: null,
            columns: [{ label }, { label: 'Count' }, { label: 'Share' }],
            rows: [...data.rows.map(r => [groupLabel(chart, r.value, true), String(r.count), `${((r.count / total) * 100).toFixed(1)}%`]),
                ...(data.other ? [[`Other (${data.other.groups} more)`, String(data.other.count), `${((data.other.count / total) * 100).toFixed(1)}%`]] : [])],
            footer: ['Total', String(data.total), '100%'],
        }],
    });
    return `<div class="table-wrap chart-table"><table class="result-table"><thead><tr><th>${escapeHtml(label)}</th><th class="num">Count</th><th class="num">Share</th></tr></thead>` +
        `<tbody>${rows.join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${data.total.toLocaleString()}</td><td class="num">100%</td></tr></tfoot></table></div>` +
        downloadBarHtml(exportId);
}

// ---------------------------------------------------------------------
// Drawing a chart into its box (again when the box changes width)
// ---------------------------------------------------------------------

const resizeWatcher = new ResizeObserver(entries => {
    for (const entry of entries) {
        const box = entry.target;
        const drawn = box._drawn;
        if (!drawn || !box.clientWidth || drawn.asTable || !['bar', 'hbar', 'line', 'area', 'donut'].includes(drawn.chart.display)) continue;
        if (Math.abs(box.clientWidth - drawn.width) > 4) drawChart(box, drawn.chart, drawn.data, false);
    }
});

// asTable: the table view instead of the chart
function drawChart(box, chart, data, asTable) {
    const width = Math.max(Math.floor(box.clientWidth) || 0, 220);
    box._drawn = { chart, data, asTable, width };
    resizeWatcher.observe(box);
    if (!data.total) {
        box.innerHTML = '<p class="chart-empty">No tickets match these choices.</p>';
        return;
    }
    const display = asTable ? 'table' : chart.display;
    if (display === 'number' || !chart.groupBy) box.innerHTML = numberHtml(chart, data);
    else if (display === 'table') box.innerHTML = chartTableHtml(chart, data);
    else if (display === 'hbar') box.innerHTML = barsHtml(chart, data, width);
    else if (display === 'line' || display === 'area') box.innerHTML = lineHtml(chart, data, width, display === 'area');
    else if (display === 'donut') box.innerHTML = donutHtml(chart, data, width);
    else box.innerHTML = columnsHtml(chart, data, width);
}

// What isn't drawn: "Showing the top 10 of 105; the other 95 add up to 9,860"
// (donuts and tables show it themselves)
function chartNote(chart, data) {
    if (!data.other || ['donut', 'table', 'number'].includes(chart.display) || !chart.groupBy) return '';
    const all = data.rows.length + data.other.groups;
    return `Showing the top ${data.rows.length} of ${all.toLocaleString()}; the other ${data.other.groups.toLocaleString()} add up to ${data.other.count.toLocaleString()}.`;
}

// ---------------------------------------------------------------------
// The tooltip: one for the whole page, filled with textContent
// ---------------------------------------------------------------------

function chartTip() {
    let tip = document.getElementById('chart-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'chart-tip';
        tip.className = 'chart-tip';
        tip.innerHTML = '<strong></strong><span></span>';
        document.body.appendChild(tip);
    }
    return tip;
}

function showChartTip(value, label, x, y) {
    const tip = chartTip();
    tip.querySelector('strong').textContent = value;
    tip.querySelector('span').textContent = label;
    tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    tip.style.top = `${y - h - 12 < 8 ? y + 18 : y - h - 12}px`;
}

function hideChartTip() {
    document.getElementById('chart-tip')?.classList.remove('show');
}

function markTip(mark, x, y) {
    mark.classList.add('hover');
    showChartTip(mark.dataset.tipValue, mark.dataset.tipLabel, x, y);
}

// Where along a line chart the crosshair is: the pointer's nearest point, or a key press
function moveCrosshair(hit, index) {
    const svg = hit.ownerSVGElement;
    const box = svg.closest('.tile-body, .builder-preview-body');
    const drawn = box?._drawn;
    if (!drawn) return;
    const rows = drawn.data.rows;
    index = Math.max(0, Math.min(rows.length - 1, index));
    hit._index = index;
    const left = Number(hit.dataset.left), step = Number(hit.dataset.step);
    const top = Number(hit.dataset.top), plotH = Number(hit.dataset.plotH), max = Number(hit.dataset.max);
    const x = rows.length > 1 ? left + index * step : left + (Number(hit.getAttribute('width')) - 12) / 2;
    const y = top + plotH - (rows[index].count / max) * plotH;
    const cross = svg.querySelector('.chart-cross');
    const dot = svg.querySelector('.chart-cross-dot');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / Number(svg.getAttribute('width'));
    const row = rows[index];
    showChartTip(row.count.toLocaleString() + ` (${((row.count / drawn.data.total) * 100).toFixed(1)}%)`,
        groupLabel(drawn.chart, row.value, true), rect.left + x * scale, rect.top + y * scale);
}

function hideCrosshair(svg) {
    svg?.querySelectorAll('.chart-cross, .chart-cross-dot').forEach(el => el.setAttribute('visibility', 'hidden'));
}

document.addEventListener('pointermove', e => {
    const hit = e.target.closest?.('.line-hit');
    if (hit) {
        const svg = hit.ownerSVGElement;
        const rect = svg.getBoundingClientRect();
        const scale = rect.width / Number(svg.getAttribute('width'));
        const step = Number(hit.dataset.step) || 1;
        moveCrosshair(hit, Math.round(((e.clientX - rect.left) / scale - Number(hit.dataset.left)) / step));
        return;
    }
    const mark = e.target.closest?.('[data-tip-value]');
    if (mark) markTip(mark, e.clientX, e.clientY);
});
document.addEventListener('pointerout', e => {
    const mark = e.target.closest?.('[data-tip-value], .line-hit');
    if (!mark) return;
    mark.classList.remove('hover');
    if (mark.classList.contains('line-hit')) hideCrosshair(mark.ownerSVGElement);
    hideChartTip();
});
document.addEventListener('focusin', e => {
    const mark = e.target.closest?.('[data-tip-value]');
    if (mark && !mark.classList.contains('line-hit')) {
        const r = mark.getBoundingClientRect();
        markTip(mark, r.left + r.width / 2, r.top);
    } else if (e.target.classList?.contains('line-hit')) {
        moveCrosshair(e.target, e.target._index ?? e.target.ownerSVGElement.closest('.tile-body, .builder-preview-body')?._drawn?.data.rows.length - 1);
    }
});
document.addEventListener('focusout', e => {
    if (e.target.closest?.('[data-tip-value], .line-hit')) {
        e.target.classList.remove('hover');
        if (e.target.classList.contains('line-hit')) hideCrosshair(e.target.ownerSVGElement);
        hideChartTip();
    }
});
document.addEventListener('keydown', e => {
    if (!e.target.classList?.contains('line-hit') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const rows = e.target.ownerSVGElement.closest('.tile-body, .builder-preview-body')?._drawn?.data.rows || [];
    const now = e.target._index ?? rows.length - 1;
    moveCrosshair(e.target, e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : now + (e.key === 'ArrowLeft' ? -1 : 1));
});
// A scrolled page leaves the tooltip behind, so it goes
document.addEventListener('scroll', hideChartTip, true);
