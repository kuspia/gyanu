import { CONFIG } from './config.js?v=20260816-11';
import { el, mount } from './dom.js?v=20260816-11';
import { formatDateKey, latestViewableDateKey } from './time.js?v=20260816-11';

const DASH = '—';
const pct = (value) => value === null || value === undefined ? DASH : `${value}%`;
const CONCURRENCY = 6;

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

function resultCard(document_) {
  const analysis = document_.paperAnalysis;
  return el('article', { class: 'mock-result-card' }, [
    el('div', { class: 'detail-head mock-result-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Mock paper result' }),
        el('h3', { class: 'mock-result-date', text: formatDateKey(document_.date) })
      ]),
      el('span', { class: 'chip mock-result-score', text: `${analysis.score ?? DASH} / ${analysis.maxScore ?? 720}` })
    ]),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'entry-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Subject' }),
            el('th', { scope: 'col', text: 'Done' }),
            el('th', { scope: 'col', text: 'Right' }),
            el('th', { scope: 'col', text: 'Wrong' }),
            el('th', { scope: 'col', text: 'Accuracy' })
          ])
        ]),
        el('tbody', {}, CONFIG.subjects.map(({ key, label }) => {
          const subject = analysis.subjects?.[key] ?? {};
          return el('tr', {}, [
            el('th', { scope: 'row', text: label }),
            el('td', { text: String(subject.attempted ?? 0) }),
            el('td', { class: 'is-correct', text: String(subject.correct ?? 0) }),
            el('td', { class: 'is-wrong', text: String(subject.wrong ?? 0) }),
            el('td', { text: pct(subject.accuracy) })
          ]);
        }))
      ])
    ])
  ]);
}

export function createMockResultsView({ store }) {
  const root = el('section', { class: 'panel panel--mocks' });
  const slot = el('div', { class: 'panel-body' });
  const count = el('p', { class: 'window-note', text: 'Every saved paper analysis, newest first.' });
  root.append(
    el('header', { class: 'panel-head' }, [
      el('p', { class: 'eyebrow', text: 'Complete paper history' }),
      el('h2', { class: 'panel-title', text: 'View mock results' }),
      count
    ]),
    slot
  );

  const documentCache = new Map();
  let loadToken = 0;

  async function refresh() {
    const token = ++loadToken;
    mount(slot, [el('div', { class: 'notice' }, [
      el('h3', { text: 'Loading mock results…' }),
      el('p', { text: 'Checking every logged date for a paper analysis.' })
    ])]);

    let dates;
    try {
      dates = (await store.listEntryDates())
        .filter((date) => date <= latestViewableDateKey())
        .sort()
        .reverse();
      await mapLimited(dates.filter((date) => !documentCache.has(date)), CONCURRENCY, async (date) => {
        const document_ = await store.readEntryForDisplay(date).catch(() => null);
        documentCache.set(date, document_);
      });
    } catch (error) {
      if (token !== loadToken) return;
      mount(slot, [el('div', { class: 'notice notice--warn' }, [
        el('h3', { text: 'Could not load mock results' }),
        el('p', { text: error.message || 'Try again in a moment.' })
      ])]);
      return;
    }

    if (token !== loadToken) return;
    const results = dates
      .map((date) => documentCache.get(date))
      .filter((document_) => document_?.paperAnalysis?.subjects);
    count.textContent = results.length
      ? `${results.length} ${results.length === 1 ? 'paper result' : 'paper results'} saved · newest first`
      : 'Every saved paper analysis will appear here.';
    mount(slot, results.length
      ? [el('div', { class: 'mock-results-list' }, results.map(resultCard))]
      : [el('div', { class: 'notice' }, [
          el('h3', { text: 'No mock results yet' }),
          el('p', { text: 'When a paper analysis is included in a daily submission, its full result will be kept here.' })
        ])]);
  }

  function noteNewEntry(dateKey, document_) {
    documentCache.set(dateKey, document_);
  }

  return { element: root, refresh, noteNewEntry };
}
