import { CONFIG } from './config.js?v=20260816-11';
import { el } from './dom.js?v=20260816-11';

const DASH = '—';

const pct = (value) => (value === null || value === undefined ? DASH : `${value}%`);
const padTime = (value) => String(value).padStart(2, '0');
const clockFromMinutes = (total) => total >= 1440
  ? '24:00'
  : `${padTime(Math.floor(total / 60))}:${padTime(total % 60)}`;
const durationLabel = (total = 0) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

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

  const studyTime = document_?.studyTime;
  const savedSessions = Array.isArray(studyTime?.sessions)
    ? studyTime.sessions
    : (Number.isInteger(studyTime?.fromMinutes) && Number.isInteger(studyTime?.toMinutes)
        ? [{ fromMinutes: studyTime.fromMinutes, toMinutes: studyTime.toMinutes }]
        : []);
  const studyBlock = studyTime
    ? el('section', { class: 'study-summary' }, [
        el('div', {}, [
          el('span', { class: 'study-summary-label', text: 'Total productive study time' }),
          el('strong', { class: 'study-summary-total', text: durationLabel(studyTime.totalMinutes) })
        ]),
        savedSessions.length
          ? el('div', { class: 'study-sessions' }, savedSessions.map((session, index) =>
              el('span', {
                text: `Period ${index + 1} · ${clockFromMinutes(session.fromMinutes)}–${clockFromMinutes(session.toMinutes)} · ${durationLabel(session.toMinutes - session.fromMinutes)}`
              })))
          : el('span', {
              class: 'study-zero',
              text: studyTime.totalMinutes > 0 ? 'Entered as one honest daily total' : '0 hours recorded'
            })
      ])
    : null;

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
      return el('div', { class: `topic-block topic-block--${key}` }, [
        el('h4', { class: 'topic-head', text: label }),
        el('p', { class: 'topic-raw', text: String(raw) })
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
          el('h4', { class: 'topics-title', text: 'Paper analysis' }),
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
        ]),
        analysis.reflection
          ? el('div', { class: 'paper-reflection' }, [
              el('h5', { text: 'Issues, causes, and improvement plan' }),
              el('p', { text: analysis.reflection })
            ])
          : null
      ])
    : null;

  const remarksBlock = typeof document_?.remarks === 'string' && document_.remarks.trim()
    ? el('section', { class: 'entry-extra' }, [
        el('h4', { class: 'topics-title', text: 'Remarks / suggestions' }),
        el('p', { class: 'entry-remarks', text: document_.remarks })
      ])
    : null;

  return el('div', { class: 'entry-detail' }, [
    studyBlock,
    table,
    topicBlocks.length
      ? el('section', { class: 'topics' }, [
          el('h4', { class: 'topics-title', text: 'Topics studied, challenges faced, and help needed (if any)' }),
          el('div', { class: 'topic-grid' }, topicBlocks)
        ])
      : null,
    mockBlock,
    analysisBlock,
    remarksBlock
  ]);
}
