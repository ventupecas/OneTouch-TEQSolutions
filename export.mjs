// =====================================================================
// EXPORT: the tables shown in the chat -> downloadable files
// =====================================================================
//
// The browser sends the tables exactly as the user sees them (English
// column labels, formatted values). Every format is built from that one
// shape:
//
//   { title, question, tables: [{ title, columns: [{ label, num }], rows: [[cell]], footer }] }
//
// Document formats (pdf, docx, xlsx, csv, txt, rtf) are built in memory.
// Archive formats (zip, 7z) bundle all six document formats together.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import sevenZipBin from '7zip-bin';
import {
  AlignmentType, Document, HeadingLevel, Packer, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

const run = promisify(execFile);

export const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'rtf'];
export const ARCHIVE_FORMATS = ['zip', '7z'];
export const EXPORT_FORMATS = [...DOCUMENT_FORMATS, ...ARCHIVE_FORMATS];

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  rtf: 'application/rtf',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
};

// 7-Zip writes both archive formats
const SEVEN_ZIP = process.env.SEVEN_ZIP_PATH || sevenZipBin.path7za;

// npm does not keep the executable bit on the bundled Linux/macOS binary
if (process.platform !== 'win32' && !process.env.SEVEN_ZIP_PATH) {
  chmod(SEVEN_ZIP, 0o755).catch(() => {});
}

// ---------------------------------------------------------------------
// Input checking
// ---------------------------------------------------------------------

const MAX_CELLS = 2_000_000;

// Returns an error message, or null when the payload is usable
export function validateExport(body) {
  if (!body || typeof body !== 'object') return 'Missing export payload.';
  if (!EXPORT_FORMATS.includes(body.format)) return `Unsupported format "${body.format}".`;
  if (!Array.isArray(body.tables) || body.tables.length === 0) return 'There is no data to export.';

  let cells = 0;
  for (const t of body.tables) {
    if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) return 'Malformed table in export payload.';
    if (t.rows.some(r => !Array.isArray(r) || r.length !== t.columns.length)) return 'Table rows do not match their columns.';
    cells += t.rows.length * t.columns.length;
  }
  if (cells > MAX_CELLS) return 'That result is too large to export.';
  return null;
}

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

// Numbers stay numbers for spreadsheets/CSV; everything else reads them formatted
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}

// The downloader's time zone, which the browser sends, so dates read in their
// own clock time; the server's would be UTC inside Docker. Unknown or missing: UTC.
function exportTimeZone(payload) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: String(payload.timeZone || '') }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// "Generated Oct 21, 2026, 9:01 PM CDT"
function generatedLine(payload) {
  const when = new Date().toLocaleString('en-US', {
    timeZone: exportTimeZone(payload),
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return `Generated ${when}`;
}

// Heading lines that open every document: title, the question, the date
function headerLines(payload) {
  const lines = [payload.title || 'One Touch export'];
  if (payload.question) lines.push(`Question: ${payload.question}`);
  lines.push(generatedLine(payload));
  return lines;
}

function rowCountText(table) {
  const n = table.rows.length;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`;
}

export function exportFileName(payload) {
  const slug = String(payload.question || payload.title || 'results')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'results';
  // Today's date where the downloader is (late evening in Chicago is already tomorrow in UTC)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: exportTimeZone(payload), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `one-touch-${slug}-${parts.year}-${parts.month}-${parts.day}`;
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

function csvField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(payload) {
  const multi = payload.tables.length > 1;
  const blocks = payload.tables.map(t => {
    const lines = [];
    if (multi && t.title) lines.push(csvField(t.title));
    lines.push(t.columns.map(c => csvField(c.label)).join(','));
    for (const r of t.rows) lines.push(r.map(csvField).join(','));
    if (t.footer) lines.push(t.footer.map(csvField).join(','));
    return lines.join('\r\n');
  });
  // The BOM makes Excel open the file as UTF-8 instead of guessing
  return Buffer.from('\uFEFF' + blocks.join('\r\n\r\n') + '\r\n', 'utf8');
}

// ---------------------------------------------------------------------
// Plain text: aligned columns, long values wrapped inside their column
// ---------------------------------------------------------------------

const TXT_MAX_COL = 60;

function wrapText(text, width) {
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      // Words longer than the column are hard-split
      let w = word;
      while (w.length > width) {
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function txtTable(table) {
  const all = [table.columns.map(c => c.label), ...table.rows.map(r => r.map(cellText))];
  if (table.footer) all.push(table.footer.map(cellText));

  const widths = table.columns.map((_, i) =>
    Math.min(TXT_MAX_COL, Math.max(...all.map(r => Math.max(...r[i].split(/\r?\n/).map(l => l.length))))));

  const renderRow = row => {
    const cells = row.map((v, i) => wrapText(v, widths[i]));
    const height = Math.max(...cells.map(c => c.length));
    const lines = [];
    for (let li = 0; li < height; li++) {
      lines.push(cells.map((c, i) => {
        const v = c[li] || '';
        return table.columns[i].num ? v.padStart(widths[i]) : v.padEnd(widths[i]);
      }).join(' | ').trimEnd());
    }
    return lines.join('\n');
  };
  const rule = widths.map(w => '-'.repeat(w)).join('-+-');

  const parts = [renderRow(all[0]), rule];
  const bodyEnd = table.footer ? all.length - 1 : all.length;
  for (let i = 1; i < bodyEnd; i++) parts.push(renderRow(all[i]));
  if (table.footer) parts.push(rule, renderRow(all[all.length - 1]));
  return parts.join('\n');
}

function buildTxt(payload) {
  const out = [...headerLines(payload), ''];
  for (const t of payload.tables) {
    if (t.title) out.push(t.title, '='.repeat(t.title.length));
    out.push(rowCountText(t), '', txtTable(t), '');
  }
  return Buffer.from(out.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------
// RTF (opens in Word, WordPad, Pages, LibreOffice)
// ---------------------------------------------------------------------

function rtfEscape(value) {
  let out = '';
  for (const ch of cellText(value)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\r') continue;
    else if (ch === '\t') out += '\\tab ';
    else if (code < 128) out += ch;
    else {
      // \uN takes a signed 16-bit value; characters beyond the BMP need a surrogate pair
      for (const unit of String.fromCodePoint(code).split('')) {
        const n = unit.charCodeAt(0);
        out += `\\u${n > 32767 ? n - 65536 : n}?`;
      }
    }
  }
  return out;
}

// Landscape letter page with 0.5" margins leaves 14,400 twips for the table
const RTF_TABLE_WIDTH = 14400;

function rtfTable(table) {
  const n = table.columns.length;
  const colWidth = Math.floor(RTF_TABLE_WIDTH / n);
  const border = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';

  const row = (cells, { header = false, footer = false } = {}) => {
    const shade = header || footer ? '\\clcbpat2' : '';
    let s = `\\trowd\\trgaph80\\trleft0${header ? '\\trhdr' : ''}`;
    for (let i = 1; i <= n; i++) s += `${border}${shade}\\cellx${colWidth * i}`;
    s += '\n';
    cells.forEach((v, i) => {
      const align = table.columns[i].num ? '\\qr' : '\\ql';
      const text = rtfEscape(v);
      s += `\\pard\\intbl${align} ${header || footer ? `{\\b ${text}}` : text}\\cell\n`;
    });
    return s + '\\row\n';
  };

  let s = row(table.columns.map(c => c.label), { header: true });
  for (const r of table.rows) s += row(r);
  if (table.footer) s += row(table.footer, { footer: true });
  return s + '\\pard\\par\n';
}

function buildRtf(payload) {
  const [title, ...rest] = headerLines(payload);
  const fontSize = payload.tables.some(t => t.columns.length > 8) ? 14 : 18;
  let s = '{\\rtf1\\ansi\\ansicpg1252\\deff0\n' +
    '{\\fonttbl{\\f0\\fswiss Helvetica;}}\n' +
    '{\\colortbl;\\red26\\green32\\blue44;\\red237\\green242\\blue247;\\red113\\green128\\blue150;}\n' +
    '\\paperw15840\\paperh12240\\landscape\\margl720\\margr720\\margt720\\margb720\n' +
    `\\pard{\\b\\fs32\\cf1 ${rtfEscape(title)}}\\par\n`;
  for (const line of rest) s += `\\pard{\\fs18\\cf3 ${rtfEscape(line)}}\\par\n`;
  s += '\\pard\\par\n';

  for (const t of payload.tables) {
    if (t.title) s += `\\pard{\\b\\fs24 ${rtfEscape(t.title)}}\\par\n`;
    s += `\\pard{\\fs16\\cf3 ${rtfEscape(rowCountText(t))}}\\par\n`;
    s += `{\\fs${fontSize}\n${rtfTable(t)}}`;
  }
  return Buffer.from(s + '}', 'utf8');
}

// ---------------------------------------------------------------------
// Excel: one worksheet per table
// ---------------------------------------------------------------------

function sheetName(title, index, used) {
  let base = String(title || `Results ${index + 1}`).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet ${index + 1}`;
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 28)} ${k}`;
  used.add(name.toLowerCase());
  return name;
}

async function buildXlsx(payload) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'One Touch';
  wb.created = new Date();
  const used = new Set();

  payload.tables.forEach((t, idx) => {
    const ws = wb.addWorksheet(sheetName(t.title, idx, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(t.columns.map(c => c.label));
    for (const r of t.rows) ws.addRow(r.map(v => (v === null || v === undefined ? '' : v)));
    if (t.footer) ws.addRow(t.footer).font = { bold: true };

    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2F7' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };

    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const longest = Math.max(c.label.length, ...t.rows.map(r => cellText(r[i]).length));
      col.width = Math.min(60, Math.max(10, longest + 2));
      if (c.num) col.numFmt = '#,##0';
      else if (longest > 60) col.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------

function docxParagraph(text, { bold = false, size, align } = {}) {
  const lines = String(text).split(/\r?\n/);
  return new Paragraph({
    alignment: align,
    children: lines.map((line, i) => new TextRun({ text: line, bold, size, break: i > 0 ? 1 : undefined })),
  });
}

function docxTable(table) {
  const size = table.columns.length > 8 ? 14 : 18; // half-points
  const shade = { type: ShadingType.CLEAR, color: 'auto', fill: 'EDF2F7' };
  const makeRow = (cells, { header = false, footer = false } = {}) => new TableRow({
    tableHeader: header,
    children: cells.map((v, i) => new TableCell({
      shading: header || footer ? shade : undefined,
      children: [docxParagraph(cellText(v), {
        bold: header || footer,
        size,
        align: table.columns[i].num ? AlignmentType.RIGHT : AlignmentType.LEFT,
      })],
    })),
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      makeRow(table.columns.map(c => c.label), { header: true }),
      ...table.rows.map(r => makeRow(r)),
      ...(table.footer ? [makeRow(table.footer, { footer: true })] : []),
    ],
  });
}

async function buildDocx(payload) {
  const [title, ...rest] = headerLines(payload);
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...rest.map(l => docxParagraph(l, { size: 18 })),
    new Paragraph(''),
  ];
  for (const t of payload.tables) {
    if (t.title) children.push(new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_2 }));
    children.push(docxParagraph(rowCountText(t), { size: 16 }), docxTable(t), new Paragraph(''));
  }

  const doc = new Document({
    creator: 'One Touch',
    title,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

// The built-in PDF fonts need no font files on disk
const pdfPrinter = new PdfPrinter({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

// The built-in fonts only cover Western European characters
function pdfSafe(value) {
  return cellText(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u2013\u2014\u2026\u20AC]/g, '?');
}

function pdfTable(table) {
  const n = table.columns.length;
  const fontSize = n > 12 ? 6 : n > 8 ? 7 : 9;
  const cell = (v, i, bold, fill) => ({
    text: pdfSafe(v),
    bold,
    fillColor: fill,
    alignment: table.columns[i].num ? 'right' : 'left',
  });

  const body = [
    table.columns.map((c, i) => cell(c.label, i, true, '#edf2f7')),
    ...table.rows.map(r => r.map((v, i) => cell(v, i, false))),
  ];
  if (table.footer) body.push(table.footer.map((v, i) => cell(v, i, true, '#edf2f7')));

  // A field/value card keeps its label column narrow
  const isDetail = n === 2 && table.columns[0].label === 'Field';
  return {
    fontSize,
    table: { headerRows: 1, dontBreakRows: false, widths: isDetail ? [150, '*'] : Array(n).fill('*'), body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#cbd5e0',
      vLineColor: () => '#cbd5e0',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 14],
  };
}

function buildPdf(payload) {
  const [title, ...rest] = headerLines(payload);
  const content = [
    { text: pdfSafe(title), fontSize: 16, bold: true, color: '#1a202c', margin: [0, 0, 0, 4] },
    ...rest.map(l => ({ text: pdfSafe(l), fontSize: 9, color: '#718096' })),
    { text: ' ', margin: [0, 0, 0, 6] },
  ];
  for (const t of payload.tables) {
    if (t.title) content.push({ text: pdfSafe(t.title), fontSize: 12, bold: true, margin: [0, 6, 0, 2] });
    content.push({ text: rowCountText(t), fontSize: 8, color: '#718096', margin: [0, 0, 0, 4] }, pdfTable(t));
  }

  const doc = pdfPrinter.createPdfKitDocument({
    info: { title: pdfSafe(title), creator: 'One Touch' },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    footer: (page, pages) => ({ text: `Page ${page} of ${pages}`, alignment: 'center', fontSize: 8, color: '#a0aec0' }),
    content,
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------------
// Archives: every document format bundled into one file
// ---------------------------------------------------------------------

const BUILDERS = { pdf: buildPdf, docx: buildDocx, xlsx: buildXlsx, csv: buildCsv, txt: buildTxt, rtf: buildRtf };

async function buildArchive(payload, format, baseName) {
  const dir = await mkdtemp(path.join(tmpdir(), 'one-touch-export-'));
  try {
    const filesDir = path.join(dir, 'files');
    await mkdir(filesDir);

    const names = [];
    for (const fmt of DOCUMENT_FORMATS) {
      const name = `${baseName}.${fmt}`;
      await writeFile(path.join(filesDir, name), await BUILDERS[fmt](payload));
      names.push(name);
    }

    const out = path.join(dir, `archive.${format}`);
    try {
      await run(SEVEN_ZIP, ['a', `-t${format}`, '-bd', '-y', out, ...names], { cwd: filesDir });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ExportUnavailableError('The 7-Zip tool is missing on this server, so archives cannot be created.');
      }
      throw err;
    }
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class ExportUnavailableError extends Error {}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export async function buildExport(payload) {
  const format = payload.format;
  const baseName = exportFileName(payload);
  const buffer = ARCHIVE_FORMATS.includes(format)
    ? await buildArchive(payload, format, baseName)
    : await BUILDERS[format](payload);
  return { buffer, fileName: `${baseName}.${format}`, contentType: MIME_TYPES[format] };
}
