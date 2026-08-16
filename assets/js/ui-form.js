import { CONFIG } from './config.js?v=20260816-1';
import { el, mount } from './dom.js?v=20260816-1';
import { entryDetail } from './ui-entry.js?v=20260816-1';
import { formatDateKey, formatWakeTime, istParts, istTimestamp, submittableDateKey } from './time.js?v=20260816-1';
import { buildEntryDocument, validateEntry } from './validation.js?v=20260816-1';
import { isAlreadySubmittedError } from './github.js?v=20260816-1';

const COUNT_FIELDS = [
  { key: 'attempted', label: 'Questions done', hint: 'Attempted on your own' },
  { key: 'correct', label: 'Correct', hint: null },
  { key: 'wrong', label: 'Wrong', hint: null }
];

function fieldShell(labelText, input, hint) {
  const error = el('p', { class: 'field-error', role: 'alert' });
  const wrap = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: labelText }),
    input,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
    error
  ]);
  return { wrap, error };
}

export function createSubmitView({ store, onSubmitted, onRequestToken, onAuthFailure, onBrowse }) {
  const root = el('section', { class: 'panel panel--submit' });
  const slot = el('div', { class: 'panel-body' });
  const eyebrow = el('p', { class: 'eyebrow', text: 'Logging progress for' });
  const heading = el('h2', { class: 'panel-title' });
  const windowNote = el('p', { class: 'window-note' });
  root.append(el('header', { class: 'panel-head' }, [eyebrow, heading, windowNote]), slot);

  let targetDate = submittableDateKey();
  let state = 'loading';
  const touched = new Set();
  const inputs = new Map();
  const errorNodes = new Map();
  let submitBtn = null;
  let formError = null;
  let mockTaken = '';
  let paperAnalysisEnabled = false;

  function readForm() {
    const subjects = {};
    const paperSubjects = {};
    for (const { key } of CONFIG.subjects) {
      subjects[key] = {
        attempted: inputs.get(`${key}.attempted`)?.value ?? '',
        correct: inputs.get(`${key}.correct`)?.value ?? '',
        wrong: inputs.get(`${key}.wrong`)?.value ?? '',
        topics: inputs.get(`${key}.topics`)?.value ?? ''
      };
      paperSubjects[key] = {
        attempted: inputs.get(`paperAnalysis.${key}.attempted`)?.value ?? '',
        correct: inputs.get(`paperAnalysis.${key}.correct`)?.value ?? '',
        wrong: inputs.get(`paperAnalysis.${key}.wrong`)?.value ?? ''
      };
    }
    return {
      date: targetDate,
      wakeUpTime: inputs.get('wakeUpTime')?.value ?? '',
      subjects,
      mockPaper: {
        taken: mockTaken,
        experience: inputs.get('mockPaper.experience')?.value ?? ''
      },
      paperAnalysis: {
        enabled: paperAnalysisEnabled,
        subjects: paperSubjects,
        score: inputs.get('paperAnalysis.score')?.value ?? ''
      }
    };
  }

  function paintValidation({ force = false } = {}) {
    const result = validateEntry(readForm());

    // Once any part of a subject is touched the whole subject reports itself.
    // Otherwise starting one box would disable submit while the field that is
    // actually missing stays silent.
    const startedSubject = (key) =>
      [...COUNT_FIELDS.map((f) => `${key}.${f.key}`), `${key}.topics`].some((n) => touched.has(n));

    for (const [name, node] of errorNodes) {
      if (name.endsWith('.balance')) continue;
      const message = result.errors[name];
      const show = Boolean(message) && (force || touched.has(name) || startedSubject(name.split('.')[0]));
      node.textContent = show ? message : '';
      inputs.get(name)?.classList.toggle('is-invalid', show);
    }

    for (const { key } of CONFIG.subjects) {
      const node = errorNodes.get(`${key}.balance`);
      if (!node) continue;
      const message = result.errors[`${key}.balance`];
      const anyTouched = COUNT_FIELDS.some((f) => touched.has(`${key}.${f.key}`));
      node.textContent = message && (force || anyTouched) ? message : '';
      node.classList.toggle('is-visible', Boolean(node.textContent));

      const paperNode = errorNodes.get(`paperAnalysis.${key}.balance`);
      if (!paperNode) continue;
      const paperMessage = result.errors[`paperAnalysis.${key}.balance`];
      const paperTouched = COUNT_FIELDS.some((f) => touched.has(`paperAnalysis.${key}.${f.key}`));
      paperNode.textContent = paperMessage && (force || paperTouched) ? paperMessage : '';
      paperNode.classList.toggle('is-visible', Boolean(paperNode.textContent));
    }

    if (submitBtn) submitBtn.disabled = !result.valid || state === 'submitting';
    return result;
  }

  function buildCountInput(subjectKey, field) {
    const name = `${subjectKey}.${field.key}`;
    const mark = () => {
      touched.add(name);
      paintValidation();
    };
    const keepDigitsOnly = (event) => {
      event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '');
      mark();
    };
    const input = el('input', {
      type: 'text',
      inputMode: 'numeric',
      autocomplete: 'off',
      spellcheck: false,
      maxLength: 3,
      placeholder: '0',
      class: 'input input--count',
      'aria-label': `${field.label} in ${subjectKey}`,
      oninput: keepDigitsOnly,
      onblur: mark
    });
    inputs.set(name, input);
    const { wrap, error } = fieldShell(field.label, input, field.hint);
    errorNodes.set(name, error);
    return wrap;
  }

  function buildTopicsInput(subjectKey, label) {
    const name = `${subjectKey}.topics`;
    const mark = () => {
      touched.add(name);
      paintValidation();
    };
    const area = el('textarea', {
      class: 'input input--topics',
      rows: 2,
      maxLength: 600,
      spellcheck: true,
      autocapitalize: 'sentences',
      placeholder: 'Rotational motion, Ray optics…',
      'aria-label': `Topics studied in ${label}`,
      oninput: mark,
      onblur: mark
    });
    inputs.set(name, area);
    const { wrap, error } = fieldShell('Topics studied', area, 'Separate with commas, full stops or new lines.');
    errorNodes.set(name, error);
    wrap.classList.add('field--topics');
    return wrap;
  }

  function buildMockPaperSection() {
    const experienceSlot = el('div');
    const choiceError = el('p', { class: 'field-error', role: 'alert' });
    errorNodes.set('mockPaper.taken', choiceError);

    function renderExperience() {
      inputs.delete('mockPaper.experience');
      errorNodes.delete('mockPaper.experience');
      if (mockTaken !== 'yes') {
        mount(experienceSlot, []);
        return;
      }
      const name = 'mockPaper.experience';
      const mark = () => {
        touched.add(name);
        paintValidation();
      };
      const area = el('textarea', {
        class: 'input input--experience',
        rows: 4,
        maxLength: 800,
        spellcheck: true,
        autocapitalize: 'sentences',
        placeholder: 'How did it feel? What went well, and what needs improvement?',
        oninput: mark,
        onblur: mark
      });
      inputs.set(name, area);
      const field = fieldShell('Share your experience in 2–3 lines', area, null);
      errorNodes.set(name, field.error);
      mount(experienceSlot, [field.wrap]);
    }

    const choices = ['yes', 'no'].map((value) => el('label', { class: 'choice' }, [
      el('input', {
        type: 'radio',
        name: 'mock-paper-taken',
        value,
        onchange: () => {
          mockTaken = value;
          touched.add('mockPaper.taken');
          renderExperience();
          paintValidation();
        }
      }),
      el('span', { text: value === 'yes' ? 'Yes' : 'No' })
    ]));

    return el('section', { class: 'form-section form-section--divided' }, [
      el('h3', { class: 'section-title', text: 'Did you take an institute NEET mock yesterday?' }),
      el('div', { class: 'choice-row' }, choices),
      choiceError,
      experienceSlot
    ]);
  }

  function buildPaperAnalysisSection() {
    const analysisSlot = el('div');

    function clearAnalysisFields() {
      for (const name of [...inputs.keys()]) {
        if (name.startsWith('paperAnalysis.')) inputs.delete(name);
      }
      for (const name of [...errorNodes.keys()]) {
        if (name.startsWith('paperAnalysis.')) errorNodes.delete(name);
      }
    }

    function buildAnalysisCountInput(subjectKey, subjectLabel, field) {
      const name = `paperAnalysis.${subjectKey}.${field.key}`;
      const mark = () => {
        touched.add(name);
        paintValidation();
      };
      const input = el('input', {
        type: 'text',
        inputMode: 'numeric',
        autocomplete: 'off',
        maxLength: 3,
        placeholder: '0',
        class: 'input input--count',
        'aria-label': `${field.label} in ${subjectLabel} paper analysis`,
        oninput: (event) => {
          event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '');
          mark();
        },
        onblur: mark
      });
      inputs.set(name, input);
      const shell = fieldShell(field.label, input, null);
      errorNodes.set(name, shell.error);
      return shell.wrap;
    }

    function renderAnalysis() {
      clearAnalysisFields();
      if (!paperAnalysisEnabled) {
        mount(analysisSlot, []);
        return;
      }

      const cards = CONFIG.subjects.map(({ key, label }) => {
        const balance = el('p', { class: 'balance-error', role: 'alert' });
        errorNodes.set(`paperAnalysis.${key}.balance`, balance);
        return el('article', { class: `subject-card subject-card--${key}` }, [
          el('h4', { class: 'subject-title' }, [el('span', { class: 'subject-dot' }), label]),
          el('div', { class: 'count-grid' }, COUNT_FIELDS.map((field) =>
            buildAnalysisCountInput(key, label, field)
          )),
          balance
        ]);
      });

      const scoreName = 'paperAnalysis.score';
      const scoreInput = el('input', {
        type: 'text',
        inputMode: 'numeric',
        autocomplete: 'off',
        maxLength: 3,
        placeholder: '0',
        class: 'input input--score',
        oninput: (event) => {
          event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '');
          touched.add(scoreName);
          paintValidation();
        },
        onblur: () => {
          touched.add(scoreName);
          paintValidation();
        }
      });
      inputs.set(scoreName, scoreInput);
      const scoreField = fieldShell('Total marks out of 720', scoreInput, null);
      errorNodes.set(scoreName, scoreField.error);

      mount(analysisSlot, [
        el('p', { class: 'section-note', text: 'Fill all three subjects. Right + Wrong must equal Questions done.' }),
        el('div', { class: 'subject-grid' }, cards),
        el('div', { class: 'score-row' }, [scoreField.wrap])
      ]);
    }

    const toggle = el('input', {
      type: 'checkbox',
      onchange: (event) => {
        paperAnalysisEnabled = event.currentTarget.checked;
        renderAnalysis();
        paintValidation();
      }
    });

    return el('section', { class: 'form-section form-section--divided' }, [
      el('h3', { class: 'section-title', text: 'Last paper analysis' }),
      el('p', { class: 'section-note', text: 'This can be added whenever you analyse your most recent paper, even days later.' }),
      el('label', { class: 'analysis-toggle' }, [toggle, el('span', { text: 'Add paper analysis' })]),
      analysisSlot
    ]);
  }

  function buildForm() {
    touched.clear();
    inputs.clear();
    errorNodes.clear();
    mockTaken = '';
    paperAnalysisEnabled = false;

    const mark = () => {
      touched.add('wakeUpTime');
      paintValidation();
    };
    const wakeInput = el('input', { type: 'time', class: 'input input--time', oninput: mark, onblur: mark });
    inputs.set('wakeUpTime', wakeInput);
    const wakeField = fieldShell('Wake-up time', wakeInput, 'When you actually got out of bed.');
    errorNodes.set('wakeUpTime', wakeField.error);

    const subjectCards = CONFIG.subjects.map(({ key, label }) => {
      const balance = el('p', { class: 'balance-error', role: 'alert' });
      errorNodes.set(`${key}.balance`, balance);
      return el('article', { class: `subject-card subject-card--${key}` }, [
        el('h3', { class: 'subject-title' }, [el('span', { class: 'subject-dot' }), label]),
        el('div', { class: 'count-grid' }, COUNT_FIELDS.map((f) => buildCountInput(key, f))),
        balance,
        buildTopicsInput(key, label)
      ]);
    });

    formError = el('p', { class: 'form-error', role: 'alert' });
    submitBtn = el('button', { type: 'submit', class: 'btn btn--primary', disabled: true, text: 'Submit progress' });

    const form = el('form', {
      class: 'entry-form',
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        handleSubmit();
      }
    }, [
      el('div', { class: 'wake-row' }, [wakeField.wrap]),
      el('section', { class: 'form-section' }, [
        el('h3', { class: 'section-title', text: 'Self-practice mode' }),
        el('p', { class: 'section-note', text: 'Optional — leave every subject blank if you did not study or attempt questions that day.' }),
        el('div', { class: 'subject-grid' }, subjectCards)
      ]),
      buildMockPaperSection(),
      buildPaperAnalysisSection(),
      formError,
      el('div', { class: 'form-actions' }, [
        submitBtn,
        el('p', { class: 'form-note', text: 'One submission for this date. It cannot be edited or deleted afterwards.' })
      ])
    ]);

    mount(slot, [form]);
    paintValidation();
  }

  async function clockProblem() {
    const bracket = await store.primeServerTime();
    if (!bracket) return null;
    const drift = Date.now() - bracket.observedAtMs;
    const slack = 10 * 60 * 1000;
    const now = Date.now();
    if (now < bracket.earliestMs + drift - slack || now > bracket.latestMs + drift + slack) {
      return 'This device clock disagrees with GitHub by more than an hour. Fix the system time before logging.';
    }
    return null;
  }

  function resetSubmitButton() {
    state = 'ready';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit progress';
  }

  async function handleSubmit() {
    const result = paintValidation({ force: true });
    if (!result.valid) return;

    const confirmed = window.confirm(
      `Are you sure you want to submit progress for ${formatDateKey(targetDate)}?\n\nDouble-check your answers. This entry cannot be edited or deleted afterwards.`
    );
    if (!confirmed) return;

    formError.textContent = '';
    state = 'submitting';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking…';

    const problem = await clockProblem();
    if (problem) {
      resetSubmitButton();
      formError.textContent = problem;
      return;
    }
    if (submittableDateKey() !== targetDate) {
      formError.textContent = 'The date rolled over while this form was open. Reload to log the new day.';
      refresh();
      return;
    }

    submitBtn.textContent = 'Submitting…';
    const document_ = buildEntryDocument(result.value, { submittedAt: istTimestamp() });

    try {
      await store.createEntry(targetDate, document_);
      state = 'done';
      renderSubmitted(document_, { justNow: true });
      updateWindowNote();
      onSubmitted?.(targetDate, document_);
    } catch (error) {
      if (isAlreadySubmittedError(error)) {
        formError.textContent = 'This day was already logged. Entries are permanent.';
        refresh();
        return;
      }
      if (error.status === 401 || error.status === 403) {
        resetSubmitButton();
        if (error.status === 401) onAuthFailure?.();
        if (error.status === 403) {
          formError.textContent = error.message;
        } else {
          formError.textContent = onRequestToken
            ? 'GitHub rejected the token — it has expired or been revoked. Reconnect a new one.'
            : 'Progress could not be saved from this phone. Nothing is lost — tell bhaiya and submit again once it is fixed.';
        }
        return;
      }
      // A dropped connection can still have committed. Confirm before reporting failure.
      let landed = null;
      try {
        landed = await store.readEntry(targetDate);
      } catch {
        landed = null;
      }
      if (landed) {
        state = 'done';
        renderSubmitted(landed, { justNow: true });
        updateWindowNote();
        onSubmitted?.(targetDate, landed);
        return;
      }
      resetSubmitButton();
      formError.textContent = error.message || 'Could not reach GitHub. Check the connection and try again.';
    }
  }

  function renderSubmitted(document_, { justNow = false } = {}) {
    mount(slot, [
      el('div', { class: `notice notice--done${justNow ? ' notice--celebrate' : ''}` }, [
        el('h3', { text: justNow ? 'Logged. Nice work.' : 'Already logged' }),
        el('p', {
          text: justNow
            ? 'This entry is permanent now. The next window opens after midnight IST.'
            : `Submitted ${document_.submittedAt ?? 'earlier'}. Entries cannot be edited.`
        })
      ]),
      entryDetail(document_),
      el('p', {
        class: 'entry-footnote',
        text: `Wake-up ${formatWakeTime(document_.wakeUpTime)} · ${document_.totals?.attempted ?? 0} questions · ${document_.totals?.accuracy ?? '—'}% overall`
      })
    ]);
  }

  // Gyanu sees this once, before his phone is set up. Everyone else who opens
  // the link sees it every time, so it is written for them: read-only is the
  // normal state here, not an error.
  function renderNeedsToken() {
    mount(slot, [
      el('div', { class: 'notice notice--warn' }, [
        el('h3', { text: onRequestToken ? 'Connect GitHub to log progress' : 'This phone is not set up yet' }),
        el('p', {
          text: onRequestToken
            ? 'Paste a fine-grained token with Contents: Read and write on this repository.'
            : 'Progress cannot be submitted from here yet. Go to bhaiya — he will set it up once, and it will never ask again.'
        }),
        onRequestToken
          ? el('button', { class: 'btn btn--primary', type: 'button', text: 'Connect token', onclick: () => onRequestToken() })
          : el('button', { class: 'btn btn--primary', type: 'button', text: 'View progress', onclick: () => onBrowse?.() })
      ])
    ]);
  }

  function renderMessage(title, body, retry = false) {
    mount(slot, [
      el('div', { class: 'notice' }, [
        el('h3', { text: title }),
        el('p', { text: body }),
        retry ? el('button', { class: 'btn btn--ghost', type: 'button', text: 'Try again', onclick: () => refresh() }) : null
      ])
    ]);
  }

  function updateWindowNote() {
    heading.textContent = formatDateKey(targetDate);
    if (state === 'done' || state === 'locked') {
      windowNote.textContent = 'This window is used. The next one opens at midnight IST.';
      return;
    }
    const { hours, minutes } = istParts();
    const left = 24 * 60 - (hours * 60 + minutes);
    windowNote.textContent = `Open all day — ${Math.floor(left / 60)}h ${left % 60}m left before this window closes at midnight IST.`;
  }

  async function refresh() {
    targetDate = submittableDateKey();
    state = 'loading';
    updateWindowNote();

    // Without a token nothing can be submitted, so skip the lookup entirely.
    // It used to run on every load and burn an API request for no reason.
    if (!store.hasToken) {
      state = 'needs-token';
      renderNeedsToken();
      updateWindowNote();
      return;
    }

    renderMessage('Checking…', 'Looking up whether this day has already been logged.');

    // Both of these read the static data folder, not the GitHub API. The token
    // is reserved for the write itself; and even if this list were stale, the
    // create-only PUT is what actually enforces one-entry-per-day.
    let logged = [];
    try {
      logged = await store.listEntryDates();
    } catch (error) {
      state = 'error';
      renderMessage('Could not load progress', error.message || 'Try again in a moment.', true);
      updateWindowNote();
      return;
    }

    if (logged.includes(targetDate)) {
      state = 'locked';
      const existing = await store.readEntryForDisplay(targetDate).catch(() => null);
      if (existing) {
        renderSubmitted(existing);
      } else {
        renderMessage('Already logged', `${formatDateKey(targetDate)} has already been submitted. Entries cannot be edited.`);
      }
    } else {
      state = 'ready';
      buildForm();
    }
    updateWindowNote();
  }

  setInterval(updateWindowNote, 30000);

  return { element: root, refresh };
}
