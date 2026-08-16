import { CONFIG } from './config.js?v=20260816-11';
import { $, el, mount } from './dom.js?v=20260816-11';
import { GitHubStore } from './github.js?v=20260816-11';
import { createCalendarView } from './ui-calendar.js?v=20260816-13';
import { createSubmitView } from './ui-form.js?v=20260816-14';
import { createMockResultsView } from './ui-mocks.js?v=20260816-14';
import { formatDateKey, istClock, istDateKey } from './time.js?v=20260816-11';

const store = new GitHubStore(localStorage.getItem(CONFIG.storageKeys.token));

const tabsNode = $('#tabs');
const viewsNode = $('#views');
const clockNode = $('#ist-clock');
const dateNode = $('#ist-date');
const bannerNode = $('#banner');
const dialog = $('#token-dialog');

const SETUP_MODE = new URLSearchParams(location.search).has('setup');

const calendar = createCalendarView({ store });
const mockResults = createMockResultsView({ store });
const submit = createSubmitView({
  store,
  onRequestToken: SETUP_MODE ? () => openTokenDialog() : null,
  onAuthFailure: () => showBanner('The saved GitHub token was rejected. Progress cannot be submitted until it is replaced.'),
  onBrowse: () => switchTab('view'),
  onSubmitted: (dateKey, document_) => {
    calendar.noteNewEntry(dateKey, document_);
    mockResults.noteNewEntry(dateKey, document_);
  }
});

const TABS = [
  { id: 'submit', label: 'Submit progress', view: submit },
  { id: 'view', label: 'View progress', view: calendar },
  { id: 'mocks', label: 'View mock results', view: mockResults }
];

let activeTab = 'view';

function renderTabs() {
  mount(tabsNode, TABS.map((tab) => el('button', {
    class: `tab${activeTab === tab.id ? ' is-active' : ''}`,
    type: 'button',
    role: 'tab',
    'aria-selected': String(activeTab === tab.id),
    text: tab.label,
    onclick: () => switchTab(tab.id)
  })));
}

function switchTab(id) {
  if (activeTab === id) return;
  activeTab = id;
  renderTabs();
  const tab = TABS.find((t) => t.id === id);
  mount(viewsNode, [tab.view.element]);
  tab.view.refresh();
}

// Gyanu only ever sees the plain-language half of this. The repair control is
// reserved for ?setup=1, so nothing token-shaped is exposed to him.
function showBanner(message, tone = 'warn') {
  mount(bannerNode, [
    el('div', { class: `banner banner--${tone}` }, [
      el('span', { text: SETUP_MODE ? message : 'Progress cannot be saved from this phone right now. Go to bhaiya.' }),
      SETUP_MODE
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Reconnect', onclick: openTokenDialog })
        : null
    ])
  ]);
}

function clearBanner() {
  mount(bannerNode, []);
}

function openTokenDialog() {
  const input = $('#token-input');
  $('#token-error').textContent = '';
  input.value = '';
  dialog.showModal();
  input.focus();
}

function wireTokenDialog() {
  const form = $('#token-form');
  const input = $('#token-input');
  const error = $('#token-error');
  const saveBtn = $('#token-save');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = input.value.trim();
    if (!token) {
      error.textContent = 'Paste the token first.';
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Checking…';
    error.textContent = '';

    const previous = store.token;
    store.setToken(token);
    try {
      await store.verifyToken();
      localStorage.setItem(CONFIG.storageKeys.token, token);
      dialog.close();
      clearBanner();
      submit.refresh();
      calendar.refresh();
    } catch (err) {
      store.setToken(previous);
      error.textContent = err.status === 401
        ? 'GitHub did not accept that token. Check it was copied in full and has not expired.'
        : err.message || 'Could not verify the token.';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save token';
    }
  });

  $('#token-cancel').addEventListener('click', () => dialog.close());
}

function tickClock() {
  dateNode.textContent = formatDateKey(istDateKey(), { withWeekday: false });
  clockNode.textContent = `${istClock()} IST`;
}

let lastKnownDate = istDateKey();
function watchDateRollover() {
  const now = istDateKey();
  if (now === lastKnownDate) return;
  lastKnownDate = now;
  submit.refresh();
  calendar.refresh();
}

function boot() {
  const avatar = $('#avatar');
  avatar.addEventListener('error', () => avatar.remove());

  wireTokenDialog();
  renderTabs();
  const landing = TABS.find((tab) => tab.id === activeTab);
  mount(viewsNode, [landing.view.element]);
  landing.view.refresh();

  // ?setup=1 exists only to install the token, so go straight to the dialog.
  // Without it there is no auth control anywhere in the UI.
  if (SETUP_MODE) openTokenDialog();

  tickClock();
  setInterval(tickClock, 1000);
  setInterval(watchDateRollover, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) watchDateRollover();
  });
}

boot();
