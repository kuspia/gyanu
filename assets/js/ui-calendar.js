import { CONFIG } from './config.js?v=20260816-16';
import { el, mount } from './dom.js?v=20260816-16';
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  daysBetween,
  formatDateKey,
  formatWakeTime,
  latestViewableDateKey,
  minutesFromMidnight,
  minutesToClock,
  shiftDateKey
} from './time.js?v=20260816-16';

const CONCURRENCY = 6;
const studyDuration = (total = 0) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

async function mapLimited(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function computeStreaks(sortedDates, upTo) {
  const set = new Set(sortedDates);
  let current = 0;
  let cursor = upTo;
  while (set.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of sortedDates) {
    run = previous && daysBetween(previous, key) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = key;
  }
  return { current, best };
}

const monthIndex = (year, month) => year * 12 + month;
// Accepts 'YYYY-MM' or 'YYYY-MM-DD'.
const monthIndexOf = (key) => monthIndex(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1);

export function createCalendarView({ store }) {
  const root = el('section', { class: 'panel panel--view' });
  const monthLabel = el('h2', { class: 'panel-title' });
  const prevBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '‹', 'aria-label': 'Previous month' });
  const nextBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '›', 'aria-label': 'Next month' });
  const yearSelect = el('select', { class: 'year-select', 'aria-label': 'Jump to year' });
  const statsNode = el('div', { class: 'stats' });
  const gridNode = el('div', { class: 'cal-grid' });
  const statusNode = el('p', { class: 'cal-status' });

  root.append(
    el('header', { class: 'panel-head panel-head--row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Progress calendar' }), monthLabel]),
      el('div', { class: 'month-nav' }, [prevBtn, yearSelect, nextBtn])
    ]),
    statsNode,
    el('div', { class: 'cal-weekdays' }, WEEKDAY_SHORT.map((d) => el('span', { text: d }))),
    gridNode,
    el('div', { class: 'legend' }, [
      el('span', { class: 'legend-item legend-item--logged', text: 'Logged' }),
      el('span', { class: 'legend-item legend-item--missed', text: 'Missed' }),
      el('span', { class: 'legend-item legend-item--hidden', text: 'Not open yet' })
    ]),
    statusNode
  );

  let loggedDates = [];
  let cursorYear = null;
  let cursorMonth = null;
  let loadToken = 0;
  const entryCache = new Map();

  const latest = () => latestViewableDateKey();
  const isViewable = (dateKey) => dateKey <= latest();
  const visibleDates = () => loggedDates.filter(isViewable);

  // Navigation spans the whole configured range. The Math.min/max guards mean
  // the current month is always reachable even if the range is never widened
  // past 2030, so the calendar can never trap itself.
  function bounds() {
    const currentIdx = monthIndexOf(latest());
    return {
      minIdx: Math.min(monthIndexOf(CONFIG.calendar.firstMonth), currentIdx),
      maxIdx: Math.max(monthIndexOf(CONFIG.calendar.lastMonth), currentIdx)
    };
  }

  function renderStats() {
    const upTo = latest();
    const visible = visibleDates();
    const { current, best } = computeStreaks(visible, upTo);
    const firstDate = visible[0];
    const trackedDays = firstDate ? (daysBetween(firstDate, upTo) ?? 0) + 1 : 0;
    const consistency = trackedDays > 0 ? Math.round((visible.length / trackedDays) * 100) : 0;

    const missed = firstDate ? trackedDays - visible.length : 0;

    const items = [
      ['Logged', String(visible.length), ''],
      ['Streak', `${current} ${current === 1 ? 'day' : 'days'}`, current === 0 ? 'stat--bad' : ''],
      ['Best', `${best} ${best === 1 ? 'day' : 'days'}`, ''],
      ['Missed', `${missed} ${missed === 1 ? 'day' : 'days'}`, missed > 0 ? 'stat--bad' : ''],
      ['Consistency', firstDate ? `${consistency}%` : '—', consistency < 80 && firstDate ? 'stat--bad' : '']
    ];
    mount(statsNode, items.map(([label, value, modifier]) => el('div', { class: `stat ${modifier}` }, [
      el('span', { class: 'stat-label', text: label }),
      el('strong', { class: 'stat-value', text: value })
    ])));
  }

  function renderYearOptions() {
    const { minIdx, maxIdx } = bounds();
    const maxYear = Math.floor(maxIdx / 12);
    const minYear = Math.floor(minIdx / 12);
    const options = [];
    for (let year = maxYear; year >= minYear; year -= 1) {
      options.push(el('option', { value: String(year), text: String(year), selected: year === cursorYear }));
    }
    mount(yearSelect, options);
    yearSelect.value = String(cursorYear);
    yearSelect.disabled = minYear === maxYear;
  }

  async function loadMonthDetails(year, month, loggedKeys, missedCount, notStarted) {
    const token = ++loadToken;
    const missing = loggedKeys.filter((k) => !entryCache.has(k));
    if (missing.length) {
      statusNode.textContent = 'Loading entries…';
      await mapLimited(missing, CONCURRENCY, async (key) => {
        try {
          entryCache.set(key, await store.readEntryForDisplay(key));
        } catch {
          entryCache.set(key, null);
        }
      });
    }
    if (token !== loadToken || year !== cursorYear || month !== cursorMonth) return;

    const loaded = [];
    for (const key of loggedKeys) {
      const doc = entryCache.get(key);
      if (!doc) continue;
      loaded.push(doc);
      const cell = gridNode.querySelector(`[data-date="${key}"]`);
      if (!cell) continue;
      const accuracy = doc.totals?.accuracy;
      const bar = cell.querySelector('.day-bar span');
      if (bar) bar.style.width = `${Math.max(6, Math.min(100, accuracy ?? 0))}%`;
      if (!doc.totals?.attempted) {
        cell.dataset.tier = 'none';
      } else if (accuracy !== null && accuracy !== undefined) {
        cell.dataset.tier = accuracy >= 80 ? 'high' : accuracy >= 60 ? 'mid' : 'low';
      }
      cell.title = `${doc.totals?.attempted ?? 0} self-practice questions · ${accuracy ?? '—'}% self-practice accuracy · ${studyDuration(doc.studyTime?.totalMinutes)} productive study · woke up at ${formatWakeTime(doc.wakeUpTime)}`;
    }

    if (loaded.length) {
      const totalQ = loaded.reduce((sum, d) => sum + (d.totals?.attempted ?? 0), 0);
      const totalC = loaded.reduce((sum, d) => sum + (d.totals?.correct ?? 0), 0);
      const totalStudyMinutes = loaded.reduce((sum, d) => sum + (d.studyTime?.totalMinutes ?? 0), 0);
      const wakeMinutes = loaded.map((d) => minutesFromMidnight(d.wakeUpTime)).filter((m) => m !== null);
      const avgWake = wakeMinutes.length
        ? minutesToClock(wakeMinutes.reduce((a, b) => a + b, 0) / wakeMinutes.length)
        : '—';
      const accuracy = totalQ ? Math.round((totalC / totalQ) * 1000) / 10 : 0;
      const penalty = missedCount > 0 ? ` · ${missedCount} missed` : '';
      statusNode.textContent =
        `This month — ${loaded.length} logged · ${studyDuration(totalStudyMinutes)} productive study · ${totalQ} self-practice questions · ${accuracy}% self-practice accuracy · avg wake-up ${avgWake}${penalty}`;
    } else if (notStarted) {
      statusNode.textContent = 'This month has not started yet. Each day unlocks the day after it ends.';
    } else {
      statusNode.textContent = missedCount > 0
        ? `Nothing logged in this month. ${missedCount} ${missedCount === 1 ? 'day' : 'days'} missed.`
        : 'Nothing logged in this month.';
    }
    statusNode.classList.toggle('cal-status--bad', missedCount > 0);
  }

  function renderMonth() {
    monthLabel.textContent = `${MONTH_NAMES[cursorMonth]} ${cursorYear}`;
    const monthPrefix = `${cursorYear}-${String(cursorMonth + 1).padStart(2, '0')}`;
    const loggedSet = new Set(loggedDates);
    const firstLogged = visibleDates()[0] ?? null;
    const daysInMonth = new Date(Date.UTC(cursorYear, cursorMonth + 1, 0)).getUTCDate();
    const leading = new Date(`${monthPrefix}-01T00:00:00Z`).getUTCDay();

    const nodes = [];
    for (let i = 0; i < leading; i += 1) nodes.push(el('div', { class: 'day day--blank' }));

    const loggedKeys = [];
    let missedCount = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${monthPrefix}-${String(day).padStart(2, '0')}`;
      let status;
      if (!isViewable(dateKey)) status = 'hidden';
      else if (loggedSet.has(dateKey)) status = 'logged';
      else if (!firstLogged || dateKey < firstLogged) status = 'untracked';
      else status = 'missed';

      if (status === 'logged') loggedKeys.push(dateKey);
      if (status === 'missed') missedCount += 1;
      const clickable = status === 'logged';

      const label = status === 'hidden'
        ? `${formatDateKey(dateKey)} — locked, not open yet`
        : `${formatDateKey(dateKey)} — ${status}`;

      nodes.push(el(clickable ? 'a' : 'div', {
        class: `day day--${status}`,
        href: clickable ? `entry.html?v=20260816-16&date=${encodeURIComponent(dateKey)}` : null,
        dataset: { date: dateKey },
        'aria-label': label,
        title: status === 'hidden' ? 'Locked until the day is over' : null
      }, [
        el('span', { class: 'day-num', text: String(day) }),
        status === 'logged' ? el('span', { class: 'day-bar' }, [el('span')]) : null,
        status === 'hidden' ? el('span', { class: 'day-lock', 'aria-hidden': 'true', text: '·' }) : null,
        status === 'missed' ? el('span', { class: 'day-cross', 'aria-hidden': 'true', text: '✕' }) : null
      ]));
    }

    mount(gridNode, nodes);

    const { minIdx, maxIdx } = bounds();
    const current = monthIndex(cursorYear, cursorMonth);
    prevBtn.disabled = current <= minIdx;
    nextBtn.disabled = current >= maxIdx;
    renderYearOptions();

    statusNode.textContent = '';
    loadMonthDetails(cursorYear, cursorMonth, loggedKeys, missedCount, `${monthPrefix}-01` > latest());
  }

  function step(delta) {
    const target = monthIndex(cursorYear, cursorMonth) + delta;
    const { minIdx, maxIdx } = bounds();
    if (target < minIdx || target > maxIdx) return;
    cursorYear = Math.floor(target / 12);
    cursorMonth = target - cursorYear * 12;
    renderMonth();
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  yearSelect.addEventListener('change', () => {
    const year = Number(yearSelect.value);
    const { minIdx, maxIdx } = bounds();
    const clamped = Math.min(Math.max(monthIndex(year, cursorMonth), minIdx), maxIdx);
    cursorYear = Math.floor(clamped / 12);
    cursorMonth = clamped - cursorYear * 12;
    renderMonth();
  });

  async function refresh({ focus } = {}) {
    try {
      loggedDates = (await store.listEntryDates()).sort();
      statusNode.textContent = '';
    } catch (error) {
      loggedDates = [];
      statusNode.textContent = `Could not load entries: ${error.message}`;
    }
    const anchor = focus && isViewable(focus) ? focus : latest();
    cursorYear = Number(anchor.slice(0, 4));
    cursorMonth = Number(anchor.slice(5, 7)) - 1;
    renderStats();
    renderMonth();
  }

  function noteNewEntry(dateKey, document_) {
    if (!loggedDates.includes(dateKey)) loggedDates = [...loggedDates, dateKey].sort();
    entryCache.set(dateKey, document_);
    store.primeDisplayCache(dateKey, document_);
    store.noteEntryCreated(dateKey);
    if (cursorYear !== null) {
      renderStats();
      renderMonth();
    }
  }

  return { element: root, refresh, noteNewEntry };
}
