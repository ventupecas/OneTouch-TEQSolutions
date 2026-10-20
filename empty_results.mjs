// =====================================================================
// EMPTY RESULTS: when a query finds nothing, work out why and say so
// =====================================================================
//
// "Show me open P1 incidents" -> 0 rows. Rather than a bare "no records",
// the server re-runs the query with each filter removed in turn (and checks
// the table's date coverage), so it can tell which condition emptied the
// result: "without 'state is open' there are 3 P1 incidents, all Closed".
// Claude then turns those facts into a short, direct answer.

import { ENTITY_CATALOG } from './business_logic.mjs';

// Free-text columns: grouping by them says nothing useful
const LONG_TEXT = new Set(['short_description', 'description', 'close_notes', 'work_notes',
  'comments_and_work_notes', 'additional_comments', 'change_plan', 'backout_plan',
  'verification_plan', 'purpose_of_change', 'approval_history']);

const MAX_FILTERS_CHECKED = 6;
const BREAKDOWN_LIMIT = 8;

// No rows, or only counts that are all zero ("how many open P1s" -> 0)
export function isEmptyResult(rows) {
  if (!rows.length) return true;
  if (rows.length !== 1) return false;
  const entries = Object.entries(rows[0]);
  return entries.length > 0 && entries.every(([k, v]) => k.endsWith('.count') && Number(v) === 0);
}

const describeFilter = f =>
  `${f.member} ${f.operator}${f.values?.length ? ' ' + f.values.map(v => `"${v}"`).join(', ') : ''}`;

// Timestamp columns (and their _day/_week/_month buckets)
const DATE_COLUMNS = new Set(['created', 'opened', 'updated', 'resolved', 'closed', 'fulfilled_time',
  'planned_start_date', 'planned_end_date']);

// What to group by to show what a removed filter was hiding: the column
// itself, or for dates its month (raw timestamps would list every second)
function breakdownMember(entity, member) {
  const column = member.slice(entity.length + 1);
  if (LONG_TEXT.has(column)) return null;
  const base = column.replace(/_(day|week|month)$/, '');
  if (DATE_COLUMNS.has(base)) {
    const month = `${base}_month`;
    return ENTITY_CATALOG[entity]?.dimensions.includes(month) ? `${entity}.${month}` : null;
  }
  return member;
}

const countOf = rows => Number(rows[0]?.[Object.keys(rows[0] || {}).find(k => k.endsWith('.count'))] ?? 0);

// Facts about why one empty query found nothing, as plain lines for Claude
export async function diagnoseEmpty(entity, cubeQuery, runCubeQuery) {
  const catalog = ENTITY_CATALOG[entity];
  const count = `${entity}.count`;
  const dateDim = `${entity}.${catalog?.dateColumn || 'created'}`;
  const filters = cubeQuery.filters || [];
  const facts = [];

  const [totalRows, firstRows, lastRows] = await Promise.all([
    runCubeQuery({ measures: [count] }),
    runCubeQuery({ dimensions: [dateDim], order: { [dateDim]: 'asc' }, limit: 1 }),
    runCubeQuery({ dimensions: [dateDim], order: { [dateDim]: 'desc' }, limit: 1 }),
  ]);
  const total = countOf(totalRows);
  if (!total) {
    facts.push(`${entity}: the table is empty (no data has been loaded for it).`);
    return facts;
  }
  facts.push(`${entity}: ${total.toLocaleString('en-US')} rows in total; ${dateDim} runs from ${firstRows[0]?.[dateDim]} to ${lastRows[0]?.[dateDim]}.`);
  facts.push(`${entity}: the query's filters were: ${filters.length ? filters.map(describeFilter).join('; ') : '(none)'}.`);

  // Remove one filter at a time
  const checks = filters.slice(0, MAX_FILTERS_CHECKED).map(async (f, i) => {
    const others = filters.filter((_, j) => j !== i);
    const base = others.length ? { filters: others } : {};
    const n = countOf(await runCubeQuery({ measures: [count], ...base }));
    let line = `Without the filter [${describeFilter(f)}]: ${n.toLocaleString('en-US')} rows match the other filters.`;
    const group = n > 0 ? breakdownMember(entity, f.member) : null;
    if (group) {
      const rows = await runCubeQuery({ measures: [count], dimensions: [group], ...base, order: { [count]: 'desc' }, limit: BREAKDOWN_LIMIT });
      const parts = rows.map(r => `${r[group] === null || r[group] === '' ? '(blank)' : r[group]} = ${Number(r[count]).toLocaleString('en-US')}`);
      if (parts.length) line += ` Those rows by ${group}: ${parts.join(', ')}${rows.length === BREAKDOWN_LIMIT ? ', ...' : ''}.`;
    }
    return line;
  });
  facts.push(...await Promise.all(checks));
  return facts;
}

const EXPLAIN_SYSTEM = `You explain to an IT person why their question about a ServiceNow ticket export found no results.
You get their question, what was searched for, and facts computed from the data: each ticket type's date coverage, and what each filter was hiding.
Write 1 to 3 short sentences of plain English. No markdown, no bullet points, no internal field names like "incident.state" (say "state").
Start with the direct answer, using the facts' real numbers. Examples of the tone:
- "There are no open P1 incidents right now: all 3 P1 incidents in the data are closed."
- "There are no tickets before June. Incidents in this export run from 5 July 2026 to 1 September 2026; changes and requests start on 1 June 2026."
- "No team name contains 'Wintel Ops'. The closest teams are ACN-INFRA-CLOUD-WINTEL and ..."
If one filter clearly explains the empty result, name it. If the dates asked about are outside the coverage, give the coverage.
If a table is empty because no data is loaded, say the data has not been loaded on this copy of OneTouch.
End with one short suggestion of a nearby question that would return data, when there is one. Use only the facts given; do not guess.`;

// Short explanation for the user; falls back to plain facts if Claude can't answer
export async function explainEmpty({ anthropic, model, question, searchedFor, facts }) {
  const fallback = `No matching records were found. ${facts.filter(f => / runs from | is empty/.test(f)).join(' ')}`.trim();
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: EXPLAIN_SYSTEM,
      messages: [{
        role: 'user',
        content: `Question: """${question}"""\nWhat was searched for: ${searchedFor}\n\nFacts:\n${facts.map(f => `- ${f}`).join('\n')}`,
      }],
    });
    if (message.stop_reason === 'refusal') return fallback;
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return text || fallback;
  } catch (error) {
    console.error('🔎 Could not explain the empty result:', error.message);
    return fallback;
  }
}
