import { CONFIG, SUBJECT_KEYS } from './config.js?v=20260816-4';
import { isValidDateKey, minutesFromMidnight } from './time.js?v=20260816-4';

export const WAKE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MAX = CONFIG.maxQuestionsPerSubject;
const TOPICS_MIN = 2;
const TOPICS_MAX = 600;
const MOCK_EXPERIENCE_MIN = 10;
const MOCK_EXPERIENCE_MAX = 800;
const MAX_NEET_SCORE = 720;

function countField(raw, label) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { error: `${label} is required.` };
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    return { error: `${label} must be a whole number — digits only.` };
  }
  const value = Number(text);
  if (value > MAX) {
    return { error: `${label} looks like a typo. Cap is ${MAX}.` };
  }
  return { value };
}

export function validateWakeTime(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Wake-up time is required.' };
  if (!WAKE_TIME_PATTERN.test(text)) return { error: 'Use the 24-hour HH:MM format, e.g. 05:30.' };
  return { value: text };
}

// Free-form on purpose: commas, full stops, semicolons or new lines all work.
export function splitTopics(text) {
  return String(text ?? '')
    .split(/[\n,;]+|\.(?=\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateTopics(raw, label) {
  const text = String(raw ?? '').trim();
  if (!text) return { error: `${label}: write what you studied. "Revision" or "nothing" is fine.` };
  if (text.length < TOPICS_MIN) return { error: `${label}: too short to mean anything.` };
  if (text.length > TOPICS_MAX) return { error: `${label}: keep it under ${TOPICS_MAX} characters.` };
  return { value: text };
}

export function validateSubject(raw, label) {
  const errors = {};
  const rawCounts = ['attempted', 'correct', 'wrong'].map((f) => String(raw?.[f] ?? '').trim());
  const rawTopics = String(raw?.topics ?? '').trim();
  const countsBlank = rawCounts.every((v) => v === '');

  // A subject left completely blank means he did not touch it that day. That is
  // a real answer, so it is recorded rather than forced into fake zeroes.
  if (countsBlank && !rawTopics) {
    return {
      valid: true,
      errors: {},
      value: { attempted: 0, correct: 0, wrong: 0, topics: null, topicList: [], studied: false }
    };
  }

  // Studied the theory but attempted no questions: counts fall to zero instead
  // of making him type three noughts.
  if (countsBlank) {
    const onlyTopics = validateTopics(rawTopics, label);
    if (onlyTopics.error) return { valid: false, errors: { topics: onlyTopics.error }, value: null };
    return {
      valid: true,
      errors: {},
      value: {
        attempted: 0,
        correct: 0,
        wrong: 0,
        topics: onlyTopics.value,
        topicList: splitTopics(onlyTopics.value),
        studied: true
      }
    };
  }

  const attempted = countField(raw?.attempted, 'Questions done');
  const correct = countField(raw?.correct, 'Correct');
  const wrong = countField(raw?.wrong, 'Wrong');
  const topics = validateTopics(raw?.topics, label);

  if (attempted.error) errors.attempted = attempted.error;
  if (correct.error) errors.correct = correct.error;
  if (wrong.error) errors.wrong = wrong.error;
  if (topics.error) errors.topics = topics.error;

  if (!attempted.error && !correct.error && !wrong.error) {
    const sum = correct.value + wrong.value;
    if (sum !== attempted.value) {
      errors.balance = `${label}: ${correct.value} right + ${wrong.value} wrong = ${sum}, but ${attempted.value} questions were done. These must match.`;
    }
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    value: valid
      ? {
          attempted: attempted.value,
          correct: correct.value,
          wrong: wrong.value,
          topics: topics.value,
          topicList: splitTopics(topics.value)
        }
      : null
  };
}

export function summarise(subjects) {
  const totals = SUBJECT_KEYS.reduce(
    (acc, key) => {
      const s = subjects?.[key];
      if (!s) return acc;
      acc.attempted += s.attempted;
      acc.correct += s.correct;
      acc.wrong += s.wrong;
      return acc;
    },
    { attempted: 0, correct: 0, wrong: 0 }
  );
  totals.accuracy = totals.attempted === 0 ? null : Math.round((totals.correct / totals.attempted) * 1000) / 10;
  return totals;
}

export function accuracyOf(subject) {
  if (!subject || subject.attempted === 0) return null;
  return Math.round((subject.correct / subject.attempted) * 1000) / 10;
}

function validateMockPaper(raw) {
  const errors = {};
  const taken = raw?.taken;
  if (taken !== 'yes' && taken !== 'no') {
    errors['mockPaper.taken'] = 'Choose Yes or No.';
  }

  const experience = String(raw?.experience ?? '').trim();
  if (taken === 'yes') {
    if (experience.length < MOCK_EXPERIENCE_MIN) {
      errors['mockPaper.experience'] = 'Share 2–3 lines about how the mock paper went.';
    } else if (experience.length > MOCK_EXPERIENCE_MAX) {
      errors['mockPaper.experience'] = `Keep the experience under ${MOCK_EXPERIENCE_MAX} characters.`;
    }
  }

  return {
    errors,
    value: Object.keys(errors).length === 0
      ? { taken: taken === 'yes', experience: taken === 'yes' ? experience : null }
      : null
  };
}

function validatePaperAnalysis(raw) {
  if (!raw?.enabled) return { errors: {}, value: null };

  const errors = {};
  const subjects = {};
  for (const { key, label } of CONFIG.subjects) {
    const source = raw.subjects?.[key];
    const attempted = countField(source?.attempted, `${label} attempted`);
    const correct = countField(source?.correct, `${label} right`);
    const wrong = countField(source?.wrong, `${label} wrong`);

    if (attempted.error) errors[`paperAnalysis.${key}.attempted`] = attempted.error;
    if (correct.error) errors[`paperAnalysis.${key}.correct`] = correct.error;
    if (wrong.error) errors[`paperAnalysis.${key}.wrong`] = wrong.error;
    if (!attempted.error && !correct.error && !wrong.error
        && correct.value + wrong.value !== attempted.value) {
      errors[`paperAnalysis.${key}.balance`] =
        `${label}: ${correct.value} right + ${wrong.value} wrong must equal ${attempted.value} attempted.`;
    }
    if (!attempted.error && !correct.error && !wrong.error) {
      subjects[key] = {
        attempted: attempted.value,
        correct: correct.value,
        wrong: wrong.value,
        accuracy: attempted.value === 0
          ? null
          : Math.round((correct.value / attempted.value) * 1000) / 10
      };
    }
  }

  const scoreText = String(raw.score ?? '').trim();
  if (!/^\d+$/.test(scoreText)) {
    errors['paperAnalysis.score'] = 'Total marks are required and must contain digits only.';
  } else if (Number(scoreText) > MAX_NEET_SCORE) {
    errors['paperAnalysis.score'] = `Total marks cannot be more than ${MAX_NEET_SCORE}.`;
  }

  return {
    errors,
    value: Object.keys(errors).length === 0
      ? { subjects, score: Number(scoreText), maxScore: MAX_NEET_SCORE }
      : null
  };
}

function validateStudyTime(raw, wakeUpTime) {
  const totalMinutes = Number(raw?.totalMinutes ?? 0);
  const segments = Array.isArray(raw?.segments) ? raw.segments : [];
  const wakeMinutes = minutesFromMidnight(wakeUpTime);
  let calculatedTotal = 0;
  let previousEnd = wakeMinutes;

  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes > 1440) {
    return { error: 'Study time is invalid.', value: null };
  }

  for (const segment of segments) {
    const start = segment?.startMinutes;
    const end = segment?.endMinutes;
    if (!Number.isInteger(start) || !Number.isInteger(end)
        || wakeMinutes === null || start < wakeMinutes || start < previousEnd
        || end <= start || end > 1440) {
      return { error: 'Study timeline contains an invalid time block.', value: null };
    }
    calculatedTotal += end - start;
    previousEnd = end;
  }

  if (calculatedTotal !== totalMinutes) {
    return { error: 'Study-time total does not match the selected blocks.', value: null };
  }

  return { value: { totalMinutes, segments } };
}

export function validateEntry(input) {
  const errors = {};
  const subjects = {};

  if (!isValidDateKey(input?.date)) {
    errors.date = 'Entry date must be a real calendar date in YYYY-MM-DD form.';
  }

  const wake = validateWakeTime(input?.wakeUpTime);
  if (wake.error) errors.wakeUpTime = wake.error;

  const studyTime = validateStudyTime(input?.studyTime, wake.value);
  if (studyTime.error) errors.studyTime = studyTime.error;

  for (const { key, label } of CONFIG.subjects) {
    const result = validateSubject(input?.subjects?.[key], label);
    if (result.valid) {
      subjects[key] = result.value;
    } else {
      for (const [field, message] of Object.entries(result.errors)) {
        errors[`${key}.${field}`] = message;
      }
    }
  }

  const mockPaper = validateMockPaper(input?.mockPaper);
  Object.assign(errors, mockPaper.errors);

  const paperAnalysis = validatePaperAnalysis(input?.paperAnalysis);
  Object.assign(errors, paperAnalysis.errors);

  const hasSelfPractice = CONFIG.subjects.some(({ key }) => {
    const subject = input?.subjects?.[key];
    return ['attempted', 'correct', 'wrong', 'topics']
      .some((field) => String(subject?.[field] ?? '').trim() !== '');
  });
  if (studyTime.value?.totalMinutes === 0 && hasSelfPractice) {
    errors.studyTime = 'Study time is 0 hours. Mark study blocks first, or clear every Self-practice field.';
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    value: valid
      ? {
          date: input.date,
          wakeUpTime: wake.value,
          wakeUpMinutes: minutesFromMidnight(wake.value),
          studyTime: studyTime.value,
          subjects,
          totals: summarise(subjects),
          mockPaper: mockPaper.value,
          paperAnalysis: paperAnalysis.value
        }
      : null
  };
}

export function buildEntryDocument(validated, { submittedAt, source = 'web' }) {
  return {
    schemaVersion: CONFIG.schemaVersion,
    date: validated.date,
    wakeUpTime: validated.wakeUpTime,
    wakeUpMinutes: validated.wakeUpMinutes,
    studyTime: validated.studyTime,
    subjects: SUBJECT_KEYS.reduce((acc, key) => {
      const s = validated.subjects[key];
      acc[key] = {
        attempted: s.attempted,
        correct: s.correct,
        wrong: s.wrong,
        accuracy: accuracyOf(s),
        topics: s.topics,
        topicList: s.topicList,
        studied: s.studied !== false
      };
      return acc;
    }, {}),
    totals: validated.totals,
    mockPaper: validated.mockPaper,
    paperAnalysis: validated.paperAnalysis,
    submittedAt,
    source
  };
}

// Used by the audit script. Fields added in later schema versions are only
// checked when present, so entries written years earlier still pass.
export function validateStoredDocument(doc, expectedDate) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['File is not a JSON object.'];
  if (doc.date !== expectedDate) problems.push(`"date" is ${JSON.stringify(doc.date)} but the filename says ${expectedDate}.`);
  if (!WAKE_TIME_PATTERN.test(doc.wakeUpTime ?? '')) problems.push('"wakeUpTime" is missing or not HH:MM.');

  if (doc.studyTime !== undefined) {
    const studyTime = validateStudyTime(doc.studyTime, doc.wakeUpTime);
    if (studyTime.error) problems.push(`"studyTime" is invalid — ${studyTime.error}`);
    const hasStudiedSubject = SUBJECT_KEYS.some((key) => doc.subjects?.[key]?.studied !== false);
    if (studyTime.value?.totalMinutes === 0 && hasStudiedSubject) {
      problems.push('Self-practice is recorded even though total study time is 0 hours.');
    }
  }

  for (const key of SUBJECT_KEYS) {
    const s = doc.subjects?.[key];
    if (!s) {
      problems.push(`Missing subject "${key}".`);
      continue;
    }
    const bad = ['attempted', 'correct', 'wrong'].filter(
      (f) => !Number.isInteger(s[f]) || s[f] < 0 || s[f] > MAX
    );
    if (bad.length) {
      problems.push(`"${key}" has invalid ${bad.join(', ')}.`);
      continue;
    }
    if (s.correct + s.wrong !== s.attempted) {
      problems.push(`"${key}" does not balance: ${s.correct} + ${s.wrong} != ${s.attempted}.`);
    }
    if (s.studied !== false && s.topics !== undefined && s.topics !== null
        && String(s.topics).trim().length < TOPICS_MIN) {
      problems.push(`"${key}" has an empty topics field.`);
    }
    if (s.studied === false && s.attempted !== 0) {
      problems.push(`"${key}" is marked not studied but records ${s.attempted} questions.`);
    }
  }

  if (doc.mockPaper !== undefined) {
    if (typeof doc.mockPaper?.taken !== 'boolean') {
      problems.push('"mockPaper.taken" must be true or false.');
    } else if (doc.mockPaper.taken
        && String(doc.mockPaper.experience ?? '').trim().length < MOCK_EXPERIENCE_MIN) {
      problems.push('"mockPaper.experience" is required when a mock was taken.');
    }
  }

  if (doc.paperAnalysis !== undefined && doc.paperAnalysis !== null) {
    for (const key of SUBJECT_KEYS) {
      const s = doc.paperAnalysis.subjects?.[key];
      if (!s) {
        problems.push(`Paper analysis is missing subject "${key}".`);
        continue;
      }
      if (!Number.isInteger(s.attempted) || !Number.isInteger(s.correct) || !Number.isInteger(s.wrong)
          || s.attempted < 0 || s.correct < 0 || s.wrong < 0
          || s.attempted > MAX || s.correct > MAX || s.wrong > MAX) {
        problems.push(`Paper analysis has invalid counts for "${key}".`);
      } else if (s.correct + s.wrong !== s.attempted) {
        problems.push(`Paper analysis "${key}" does not balance.`);
      }
    }
    if (!Number.isInteger(doc.paperAnalysis.score)
        || doc.paperAnalysis.score < 0 || doc.paperAnalysis.score > MAX_NEET_SCORE) {
      problems.push(`Paper analysis score must be between 0 and ${MAX_NEET_SCORE}.`);
    }
  }
  return problems;
}
