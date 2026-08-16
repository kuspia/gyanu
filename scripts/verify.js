/**
 * Audits every stored entry. Run locally; nothing on GitHub executes this.
 *
 *   npm run verify              schema + filename checks against local files
 *   npm run verify -- --remote  also checks each file's commit history
 *
 * The remote pass is the tamper check that a browser cannot fake: GitHub stamps
 * every commit with its own clock, so an entry for the 12th that was committed
 * on the 20th proves the device clock was moved.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONFIG } from '../assets/js/config.js';
import { istDateKey, shiftDateKey } from '../assets/js/time.js';
import { validateStoredDocument } from '../assets/js/validation.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const ENTRIES = join(ROOT, CONFIG.dataDir);
const remote = process.argv.includes('--remote');
const token = process.env.GITHUB_TOKEN || '';

const problems = [];
const note = (file, message) => problems.push(`${file}: ${message}`);

async function collect() {
  const found = [];
  let years;
  try {
    years = await readdir(ENTRIES, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const year of years) {
    if (!year.isDirectory()) {
      if (year.name !== '.gitkeep') note(year.name, 'Unexpected file directly inside the entries folder.');
      continue;
    }
    if (!/^\d{4}$/.test(year.name)) {
      note(year.name, 'Entry folders must be four-digit years.');
      continue;
    }
    for (const file of await readdir(join(ENTRIES, year.name))) {
      const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
      if (!match) {
        note(`${year.name}/${file}`, 'Filename must be YYYY-MM-DD.json.');
        continue;
      }
      if (!match[1].startsWith(`${year.name}-`)) {
        note(`${year.name}/${file}`, `Filed under ${year.name} but dated ${match[1]}.`);
        continue;
      }
      found.push({ dateKey: match[1], path: join(ENTRIES, year.name, file), relative: `${CONFIG.dataDir}/${year.name}/${file}` });
    }
  }
  return found.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

async function github(path) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function checkCommits(entry) {
  const commits = await github(
    `/repos/${CONFIG.owner}/${CONFIG.repo}/commits?path=${encodeURIComponent(entry.relative)}&per_page=100`
  );
  if (commits.length === 0) {
    note(entry.relative, 'No commit history — file exists locally but was never pushed.');
    return;
  }
  if (commits.length > 1) {
    note(entry.relative, `Touched by ${commits.length} commits. Entries must be written exactly once and never edited.`);
  }
  const created = commits[commits.length - 1];
  const committedAt = created.commit?.committer?.date;
  if (!committedAt) return;
  const committedIst = istDateKey(new Date(committedAt));
  const expected = shiftDateKey(entry.dateKey, 1);
  if (committedIst !== expected) {
    note(entry.relative, `Committed on ${committedIst} IST but an entry for ${entry.dateKey} may only be written on ${expected}.`);
  }
}

const entries = await collect();
const seen = new Set();

// data/index.json is what every viewer reads. If a submission wrote the entry
// but failed to update the index, the day exists yet is invisible on the site.
try {
  const indexPath = join(ROOT, CONFIG.dataDir.split('/')[0], 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const listed = new Set(index.dates ?? []);
  const actual = new Set(entries.map((e) => e.dateKey));
  for (const d of actual) if (!listed.has(d)) note('data/index.json', `missing ${d} — the entry exists but no viewer can see it.`);
  for (const d of listed) if (!actual.has(d)) note('data/index.json', `lists ${d} but no such entry file exists.`);
} catch (error) {
  note('data/index.json', `could not be read — ${error.message}`);
}

for (const entry of entries) {
  if (seen.has(entry.dateKey)) note(entry.relative, 'Duplicate date.');
  seen.add(entry.dateKey);

  if (entry.dateKey >= istDateKey()) {
    note(entry.relative, 'Dated today or in the future. Only past days can hold an entry.');
  }

  let doc;
  try {
    doc = JSON.parse(await readFile(entry.path, 'utf8'));
  } catch (error) {
    note(entry.relative, `Invalid JSON — ${error.message}`);
    continue;
  }
  for (const message of validateStoredDocument(doc, entry.dateKey)) note(entry.relative, message);
}

if (remote) {
  if (!token) console.log('No GITHUB_TOKEN set — using unauthenticated requests (60/hour).\n');
  for (const entry of entries) {
    try {
      await checkCommits(entry);
    } catch (error) {
      note(entry.relative, `Could not read commit history — ${error.message}`);
      break;
    }
  }
}

console.log(`Checked ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${remote ? ' (with commit history)' : ''}.`);
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found:\n`);
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}
console.log('All good.');
