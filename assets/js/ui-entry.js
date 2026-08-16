import { CONFIG } from './config.js?v=20260816-2';
import { el } from './dom.js?v=20260816-2';

const DASH = '—';

const pct = (value) => (value === null || value === undefined ? DASH : `${value}%`);

// Subjects are read defensively: an entry written years ago will not contain a
// field added later, and must still render rather than show a false zero.
export function entryDetail(document_) {
  const rows = CONFIG.subjects.map(({ key, label }) => {
    const s = document_?.subjects?.[key];
    if (!s) {
      return el('tr', { class: 'row--absent' }, [
        el('th', { scope: 'row', text: label }),
        el('td', { colSpan: 4, text: 'Not tracked on this day' })
      ]);
    }
    if (s.studied === false) {
      return el('tr', { class: 'row--absent' }, [
        el('th', { scope: 'row', text: label }),
        el('td', { colSpan: 4, text: 'Not studied' })
      ]);
    }
    return el('tr', {}, [
      el('th', { scope: 'row', text: label }),
      el('td', { text: String(s.attempted ?? 0) }),
      el('td', { class: 'is-correct', text: String(s.correct ?? 0) }),
      el('td', { class: 'is-wrong', text: String(s.wrong ?? 0) }),
      el('td', { text: pct(s.accuracy) })
    ]);
  });

  const totals = document_?.totals ?? {};

  const table = el('div', { class: 'table-wrap' }, [
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
      el('tbody', {}, rows),
      el('tfoot', {}, [
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Total' }),
          el('td', { text: String(totals.attempted ?? 0) }),
          el('td', { class: 'is-correct', text: String(totals.correct ?? 0) }),
          el('td', { class: 'is-wrong', text: String(totals.wrong ?? 0) }),
          el('td', { text: pct(totals.accuracy) })
        ])
      ])
    ])
  ]);

  const topicBlocks = CONFIG.subjects
    .map(({ key, label }) => {
      const s = document_?.subjects?.[key];
      const raw = s?.topics;
      if (!raw || !String(raw).trim()) return null;
      const list = Array.isArray(s.topicList) && s.topicList.length ? s.topicList : null;
      return el('div', { class: `topic-block topic-block--${key}` }, [
        el('h4', { class: 'topic-head', text: label }),
        list
          ? el('ul', { class: 'topic-list' }, list.map((t) => el('li', { text: t })))
          : el('p', { class: 'topic-raw', text: String(raw) })
      ]);
    })
    .filter(Boolean);

  const mockPaper = document_?.mockPaper;
  const mockBlock = mockPaper && typeof mockPaper.taken === 'boolean'
    ? el('section', { class: 'entry-extra' }, [
        el('h4', { class: 'topics-title', text: 'Institute NEET mock' }),
        el('p', { class: 'entry-extra-value', text: mockPaper.taken ? 'Yes' : 'No' }),
        mockPaper.taken && mockPaper.experience
          ? el('p', { class: 'entry-experience', text: mockPaper.experience })
          : null
      ])
    : null;

  const analysis = document_?.paperAnalysis;
  const analysisBlock = analysis
    ? el('section', { class: 'entry-extra' }, [
        el('div', { class: 'detail-head' }, [
          el('h4', { class: 'topics-title', text: 'Last paper analysis' }),
          el('span', { class: 'chip', text: `${analysis.score ?? '—'} / ${analysis.maxScore ?? 720}` })
        ]),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'entry-table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { scope: 'col', text: 'Subject' }),
              el('th', { scope: 'col', text: 'Done' }),
              el('th', { scope: 'col', text: 'Right' }),
              el('th', { scope: 'col', text: 'Wrong' }),
              el('th', { scope: 'col', text: 'Accuracy' })
            ])]),
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
      ])
    : null;

  return el('div', { class: 'entry-detail' }, [
    table,
    topicBlocks.length
      ? el('section', { class: 'topics' }, [
          el('h4', { class: 'topics-title', text: 'Topics studied' }),
          el('div', { class: 'topic-grid' }, topicBlocks)
        ])
      : null,
    mockBlock,
    analysisBlock
  ]);
}
