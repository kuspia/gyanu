import { CONFIG, ENTRY_PATH_PATTERN, entryPath } from './config.js?v=20260816-11';

const API = 'https://api.github.com';
const RATE_WINDOW_SECONDS = 3600;

// Resolves against the directory the page is served from, so the app works at
// kuspia.github.io/gyanu/, at a custom domain, and from a local file server.
const PAGE_BASE = new URL('.', document.baseURI);
const INDEX_PATH = `${CONFIG.dataDir.split('/')[0]}/index.json`;

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class GitHubError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

export class GitHubStore {
  #displayCache = new Map();

  constructor(token = null) {
    this.token = token || null;
    this.serverTimeBracket = null;
  }

  setToken(token) {
    this.token = token || null;
  }

  get hasToken() {
    return Boolean(this.token);
  }

  entryPath(dateKey) {
    return entryPath(dateKey);
  }

  async request(path, { method = 'GET', accept = 'application/vnd.github+json', body, anonymous = false, allowAnonymousFallback = true } = {}) {
    const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token && !anonymous) headers.Authorization = `Bearer ${this.token}`;
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch {
      throw new GitHubError('No network connection to GitHub.', { status: 0 });
    }

    this.#captureServerTime(response);

    const raw = await response.text();
    const isJson = (response.headers.get('content-type') || '').includes('json');
    let parsed = raw;
    if (isJson && raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      // An expired token must not take the whole app down. This repository is
      // public, so every read still works without credentials; only writing
      // actually needs the token.
      if (response.status === 401 && this.token && !anonymous && allowAnonymousFallback && method === 'GET') {
        return this.request(path, { method, accept, body, anonymous: true });
      }
      let message = (isJson && parsed?.message) || `GitHub returned ${response.status}.`;
      if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const mins = Number.isFinite(reset) ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
        message = mins
          ? `GitHub rate limit reached. It clears in about ${mins} minute${mins === 1 ? '' : 's'}.`
          : 'GitHub rate limit reached. Try again shortly.';
      }
      throw new GitHubError(message, { status: response.status, body: parsed });
    }
    return { data: parsed, response };
  }

  // api.github.com does not expose its Date header to browsers, but it does expose
  // x-ratelimit-reset, and the window is always one hour wide. That brackets real
  // server time to [reset - 3600, reset]: coarse, yet any clock tampering worth
  // catching here moves the date by whole days.
  #captureServerTime(response) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return;
    this.serverTimeBracket = {
      earliestMs: (reset - RATE_WINDOW_SECONDS) * 1000,
      latestMs: reset * 1000,
      observedAtMs: Date.now()
    };
  }

  async primeServerTime() {
    if (this.serverTimeBracket) return this.serverTimeBracket;
    try {
      await this.request('/rate_limit');
    } catch {
      /* offline or blocked: the clock guard degrades to a no-op */
    }
    return this.serverTimeBracket;
  }

  async verifyToken() {
    // No anonymous fallback here: this call exists precisely to find out
    // whether the token itself is still good.
    const { data: repo } = await this.request(`/repos/${CONFIG.owner}/${CONFIG.repo}`, { allowAnonymousFallback: false });
    if (!repo?.permissions?.push) {
      throw new GitHubError('That token can read the repository but not write to it. It needs Contents: Read and write.');
    }
    return { repo: repo.full_name, defaultBranch: repo.default_branch };
  }

  #listCacheKey = 'gyanu.entryDates';

  #readListCache() {
    try {
      const raw = localStorage.getItem(this.#listCacheKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  #writeListCache(dates) {
    try {
      localStorage.setItem(this.#listCacheKey, JSON.stringify({ dates, fetchedAt: Date.now() }));
    } catch { /* private mode: caching is optional */ }
  }

  noteEntryCreated(dateKey) {
    const cached = this.#readListCache();
    const dates = new Set(cached?.dates ?? []);
    dates.add(dateKey);
    this.#writeListCache([...dates].sort());
  }

  // Viewing never touches the GitHub API. Pages cannot list a directory, so
  // data/index.json acts as the index and is served as an ordinary static
  // asset — no rate limit, for any number of viewers. The Trees API below is
  // only a bootstrap fallback for when that file is missing.
  async listEntryDates() {
    const cached = this.#readListCache();
    const local = cached?.dates ?? [];
    try {
      const response = await fetch(new URL(`${INDEX_PATH}`, PAGE_BASE), { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body?.dates)) {
          // Entries submitted from this device are merged in until the Pages
          // rebuild publishes them. Once the index is newer than that local
          // cache it becomes authoritative, including intentional deletions.
          const indexUpdatedAt = Date.parse(body.updatedAt ?? '');
          const localIsNewer = !Number.isFinite(indexUpdatedAt)
            || Number(cached?.fetchedAt ?? 0) > indexUpdatedAt;
          return [...new Set([...body.dates, ...(localIsNewer ? local : [])])].sort();
        }
      }
    } catch {
      /* fall through to the API bootstrap */
    }
    return [...new Set([...(await this.#listViaTreesApi()), ...local])].sort();
  }

  async #listViaTreesApi() {
    try {
      const { data } = await this.request(
        `/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=1`
      );
      const dates = [];
      for (const node of data?.tree ?? []) {
        if (node.type !== 'blob') continue;
        const match = ENTRY_PATH_PATTERN.exec(node.path);
        if (match) dates.push(match[2]);
      }
      return data?.truncated ? await this.#listByYearDirectories(dates) : dates.sort();
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async #listByYearDirectories(seed) {
    const years = new Set(seed.map((d) => d.slice(0, 4)));
    const dates = new Set(seed);
    for (const year of years) {
      try {
        const { data } = await this.request(
          `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataDir}/${year}?ref=${CONFIG.branch}`
        );
        for (const item of Array.isArray(data) ? data : []) {
          if (item.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(item.name)) {
            dates.add(item.name.replace(/\.json$/, ''));
          }
        }
      } catch {
        /* keep whatever the tree already gave us */
      }
    }
    return [...dates].sort();
  }

  async readEntry(dateKey) {
    try {
      const { data } = await this.request(
        `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${this.entryPath(dateKey)}?ref=${CONFIG.branch}`,
        { accept: 'application/vnd.github.raw' }
      );
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  // Calendar reads hit the Pages origin first: identical JSON, served as a static
  // asset with no rate limit. The API is the fallback for an entry Pages has not
  // rebuilt yet, which is only ever the one just submitted.
  async readEntryForDisplay(dateKey) {
    if (this.#displayCache.has(dateKey)) return this.#displayCache.get(dateKey);
    let document_ = null;
    try {
      const response = await fetch(new URL(this.entryPath(dateKey), PAGE_BASE), { cache: 'no-store' });
      if (response.ok) document_ = await response.json();
    } catch {
      /* fall through to the API */
    }
    if (!document_) document_ = await this.readEntry(dateKey);
    if (document_) this.#displayCache.set(dateKey, document_);
    return document_;
  }

  primeDisplayCache(dateKey, document_) {
    this.#displayCache.set(dateKey, document_);
  }

  // Deliberately never sends `sha`. GitHub rejects a create against an existing
  // path with 422, so immutability is enforced by the server rather than the UI.
  async createEntry(dateKey, document_) {
    if (!this.token) throw new GitHubError('Connect a GitHub token before submitting.');
    const content = encodeBase64(`${JSON.stringify(document_, null, 2)}\n`);
    const { data } = await this.request(
      `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${this.entryPath(dateKey)}`,
      {
        method: 'PUT',
        body: { message: `progress: ${dateKey}`, content, branch: CONFIG.branch }
      }
    );
    this.#displayCache.delete(dateKey);
    this.noteEntryCreated(dateKey);
    await this.#appendToIndex(dateKey);
    return data;
  }

  // data/index.json is what every viewer reads, so it has to learn about the
  // new entry. Unlike an entry it is mutable, so this one does pass a sha.
  // Failure here is not fatal: the entry itself is already committed, and
  // `npm run verify` reports any drift.
  async #appendToIndex(dateKey, attempt = 0) {
    const path = INDEX_PATH;
    try {
      let sha;
      let dates = [];
      try {
        const { data: file } = await this.request(
          `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`
        );
        sha = file.sha;
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(String(file.content).replace(/\s/g, '')), (c) => c.charCodeAt(0))
        );
        dates = JSON.parse(decoded).dates ?? [];
      } catch (error) {
        if (error.status !== 404) throw error;
      }

      const merged = [...new Set([...dates, dateKey])].sort();
      const body = { dates: merged, updatedAt: new Date().toISOString() };
      await this.request(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`, {
        method: 'PUT',
        body: {
          message: `index: ${dateKey}`,
          content: encodeBase64(`${JSON.stringify(body, null, 2)}\n`),
          branch: CONFIG.branch,
          ...(sha ? { sha } : {})
        }
      });
    } catch (error) {
      // A concurrent write moved the sha; re-read once and try again.
      if ((error.status === 409 || error.status === 422) && attempt === 0) {
        return this.#appendToIndex(dateKey, 1);
      }
    }
  }
}

export function isAlreadySubmittedError(error) {
  if (!(error instanceof GitHubError)) return false;
  if (error.status === 409) return true;
  return error.status === 422 && /sha/i.test(error.message || '');
}
