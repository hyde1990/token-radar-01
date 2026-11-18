// Local gate checker for the token-radar entry. It reads one output directory (the
// one main.ts wrote) and checks the scorer's seven gate rows, then exits 0 when all
// seven pass and 1 otherwise. It never writes, never submits, never touches the
// network. Usage: node validate.mjs [out-dir] [--snapshot <snapshot.json>]
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapArg = process.argv.indexOf('--snapshot');
const snapshotPath = snapArg >= 0 ? process.argv[snapArg + 1] : '../token-radar-01-kit/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = snapshot.watchlist;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const bytes = (p) => statSync(p).size;
const read = (p) => readFileSync(p, 'utf8');

// --- 1. dashboard_files -------------------------------------------------------
{
  const dir = join(out, 'dashboard');
  const names = readdirSync(dir).sort();
  const files = names.filter((n) => lstatSync(join(dir, n)).isFile());
  const totalBytes = files.reduce((n, f) => n + bytes(join(dir, f)), 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  const badName = files.find((f) => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f));
  let urlOffense = null;
  for (const f of files) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    const text = read(join(dir, f));
    // The scorer refuses http/https in an HTML attribute, a style body, or a JS
    // import/require/dynamic-import. This entry carries no URL anywhere, so any
    // occurrence at all is treated as an offense here.
    if (text.includes('http://') || text.includes('https://')) { urlOffense = f; break; }
  }
  const ok = hasHtml && hasCss && hasJs && files.length <= 400 && totalBytes <= 4_194_304 && !badName && !urlOffense;
  check('dashboard_files', ok, `${files.length} files (${totalBytes} bytes), html=${hasHtml} css=${hasCss} js=${hasJs}` +
    (badName ? `, bad name ${badName}` : '') + (urlOffense ? `, URL in ${urlOffense}` : ''));
}

// --- 2. board_file ------------------------------------------------------------
let board = null;
{
  const p = join(out, 'board.json');
  const size = bytes(p);
  let detail = `${size} bytes`;
  let ok = size <= 8 * 1024 * 1024;
  try {
    const parsed = JSON.parse(read(p));
    board = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(board)) throw new Error('rows is not an array');
    ok = ok && board.length >= 100 && board.length <= 4000;
    detail += `, ${board.length} rows`;
    const seen = new Set();
    for (const r of board) {
      if (!snapSlugs.has(r.slug)) { ok = false; detail += `, invented slug ${r.slug}`; break; }
      if (seen.has(r.slug)) { ok = false; detail += `, duplicate slug ${r.slug}`; break; }
      seen.add(r.slug);
      if (typeof r.name !== 'string' || r.name.length === 0) { ok = false; detail += `, empty name at ${r.slug}`; break; }
      if (!Number.isSafeInteger(r.rank) || r.rank <= 0) { ok = false; detail += `, bad rank at ${r.slug}`; break; }
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
        ok = false; detail += `, bad implied value at ${r.slug}`; break;
      }
      if (!Array.isArray(r.farm_steps)) { ok = false; detail += `, no farm_steps at ${r.slug}`; break; }
    }
    if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
      ok = false; detail += ', all implied values identical';
    }
  } catch (e) {
    ok = false; detail += `, parse error: ${e.message}`;
  }
  check('board_file', ok, detail);
}

// --- 3. sorted_by_value -------------------------------------------------------
{
  let ok = Array.isArray(board) && board.length > 0;
  let detail = '';
  if (ok) {
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] !== i + 1) { ok = false; detail = `rank ${i + 1} is ${ranks[i]}`; break; }
    }
    if (ok) {
      for (let i = 1; i < board.length; i++) {
        if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
          ok = false; detail = `row ${i + 1} outranks row ${i}`; break;
        }
        if (board[i].implied_value_usd === board[i - 1].implied_value_usd) {
          ok = false; detail = `rows ${i} and ${i + 1} tie at $${board[i].implied_value_usd}`; break;
        }
      }
    }
    if (ok) detail = `${board.length} rows, ranks 1..${board.length}, strictly decreasing $${board[0].implied_value_usd} → $${board[board.length - 1].implied_value_usd}`;
  }
  check('sorted_by_value', ok, detail || 'no board');
}

// --- 4. coverage --------------------------------------------------------------
{
  const slugs = new Set((board ?? []).map((r) => r.slug));
  const missing = watchlist.filter((s) => !slugs.has(s));
  check('coverage', missing.length === 0, `${watchlist.length - missing.length}/${watchlist.length} watchlist slugs covered` +
    (missing.length ? `, missing: ${missing.slice(0, 5).join(', ')}` : ''));
}

// --- 5. farm_steps ------------------------------------------------------------
{
  let ok = Array.isArray(board);
  let detail = '';
  let worst = 0;
  let shortest = 999;
  if (ok) {
    for (const r of board) {
      const steps = r.farm_steps;
      if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
        ok = false; detail = `${r.slug} has ${steps?.length ?? 0} steps`; break;
      }
      for (const s of steps) {
        const n = s.trim().length;
        worst = Math.max(worst, n);
        shortest = Math.min(shortest, n);
        if (n < 20 || n > 600) { ok = false; detail = `${r.slug} has a step of ${n} chars`; break; }
      }
      if (!ok) break;
    }
  }
  if (ok) detail = `${board.length} rows x ${board[0].farm_steps.length} steps, step length ${shortest}..${worst} chars`;
  check('farm_steps', ok, detail || 'no board');
}

// --- 6. screenshots -----------------------------------------------------------
function pngDims(buf) {
  if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegDims(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1];
    const len = buf.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(at + 5), w: buf.readUInt16BE(at + 7) };
    }
    at += 2 + len;
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  let ok = names.length >= 3 && names.length <= 4;
  const parts = [];
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    const dims = buf[0] === 0x89 ? pngDims(buf) : jpegDims(buf);
    const long = dims ? Math.max(dims.w, dims.h) : -1;
    const short = dims ? Math.min(dims.w, dims.h) : -1;
    const good = buf.length <= 524_288 && dims !== null && long <= 1440 && short >= 800;
    if (!good) ok = false;
    parts.push(`${n} ${buf.length}B ${dims ? `${dims.w}x${dims.h}` : 'unreadable'}`);
  }
  check('screenshots', ok, `${names.length} images: ${parts.join('; ')}`);
}

// --- 7. dossier_matches -------------------------------------------------------
{
  let ok = false;
  let detail = '';
  try {
    const rebuilt = buildDossier(out, {
      text_max_bytes: 65_536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    });
    const written = readFileSync(join(out, 'dossier.json'));
    ok = Buffer.compare(Buffer.from(rebuilt), written) === 0;
    const dossierText = JSON.parse(written.toString('utf8')).text ?? '';
    const textBytes = Buffer.byteLength(dossierText, 'utf8');
    detail = `dossier.json ${written.length} bytes, rebuilt ${rebuilt.length} bytes, byte-identical=${ok}, dossier text ${textBytes} bytes (cap 65536)` +
      (written.length > 1_572_864 ? ', over the 1.5 MiB gate cap' : '') +
      (textBytes > 65_536 ? ', text over its cap' : '');
    if (written.length > 1_572_864 || textBytes > 65_536) ok = false;
  } catch (e) {
    detail = `rebuild failed: ${e.message}`;
  }
  check('dossier_matches', ok, detail);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gate rows pass`);
process.exit(failed.length ? 1 : 0);
