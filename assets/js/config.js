export const CONFIG = {
  owner: 'kuspia',
  repo: 'gyanu',
  branch: 'main',
  dataDir: 'data/entries',
  schemaVersion: 1,
  subjects: [
    { key: 'physics', label: 'Physics', accent: 'var(--physics)' },
    { key: 'chemistry', label: 'Chemistry', accent: 'var(--chemistry)' },
    { key: 'biology', label: 'Biology', accent: 'var(--biology)' }
  ],
  maxQuestionsPerSubject: 300,
  // How far the calendar can be browsed. Individual days stay locked by the
  // IST clock regardless — this only widens the month navigation, so future
  // months can be opened but every day inside them still reads as locked.
  calendar: {
    firstMonth: '2025-01',
    lastMonth: '2030-12'
  },
  storageKeys: {
    token: 'gyanu.token'
  }
};

export const SUBJECT_KEYS = CONFIG.subjects.map((s) => s.key);

// Sharded by year on purpose. A flat folder would pass GitHub's 1000-entry
// directory listing cap after roughly three years of daily logs.
export function entryPath(dateKey) {
  return `${CONFIG.dataDir}/${dateKey.slice(0, 4)}/${dateKey}.json`;
}

export const ENTRY_PATH_PATTERN = new RegExp(
  `^${CONFIG.dataDir}/(\\d{4})/(\\1-\\d{2}-\\d{2})\\.json$`
);
