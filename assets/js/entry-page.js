import { CONFIG } from './config.js?v=20260816-6';
import { $, el, mount } from './dom.js?v=20260816-6';
import { GitHubStore } from './github.js?v=20260816-6';
import { entryDetail } from './ui-entry.js?v=20260816-6';
import { formatDateKey, formatWakeTime, isValidDateKey, latestViewableDateKey } from './time.js?v=20260816-6';

const slot = $('#entry-content');
const dateKey = new URLSearchParams(location.search).get('date');
const store = new GitHubStore(localStorage.getItem(CONFIG.storageKeys.token));

function showMessage(title, message) {
  mount(slot, [
    el('div', { class: 'notice' }, [
      el('h2', { text: title }),
      el('p', { text: message }),
      el('a', { class: 'btn btn--ghost entry-back-button', href: 'index.html?v=20260816-6', text: 'Back to calendar' })
    ])
  ]);
}

async function loadEntry() {
  if (!isValidDateKey(dateKey) || dateKey > latestViewableDateKey()) {
    showMessage('Entry unavailable', 'Choose a logged date from the progress calendar.');
    return;
  }

  let document_;
  try {
    document_ = await store.readEntryForDisplay(dateKey);
  } catch (error) {
    showMessage('Could not load entry', error.message || 'Check the connection and try again.');
    return;
  }

  if (!document_) {
    showMessage('No entry for this date', 'Only green logged dates have a progress entry.');
    return;
  }

  document.title = `${formatDateKey(dateKey)} · Gyanu`;
  mount(slot, [
    el('div', { class: 'detail-head entry-page-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Progress entry' }),
        el('h2', { class: 'panel-title', text: formatDateKey(dateKey) })
      ]),
      el('span', { class: 'chip', text: `Up at ${formatWakeTime(document_.wakeUpTime)}` })
    ]),
    entryDetail(document_),
    el('p', { class: 'entry-footnote', text: `Submitted ${document_.submittedAt ?? 'unknown'}` })
  ]);
}

const avatar = $('#avatar');
avatar.addEventListener('error', () => avatar.remove());
loadEntry();
