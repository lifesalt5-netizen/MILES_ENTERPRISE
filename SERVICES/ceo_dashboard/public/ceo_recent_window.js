'use strict';

(() => {
  const RECENT_WINDOW_DAYS = 5;
  const WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const byId = id => document.getElementById(id);
  let applying = false;
  let scheduled = null;

  function parseTime(item = {}) {
    for (const field of ['timestamp','updatedAt','completedAt','createdAt','generatedAt','startedAt','lastUpdatedAt','date']) {
      const value = item?.[field];
      if (!value) continue;
      const time = Date.parse(value);
      if (Number.isFinite(time)) return time;
    }
    return null;
  }

  function withinFiveDays(item) {
    const time = parseTime(item);
    return time !== null && time >= Date.now() - WINDOW_MS;
  }

  function newestFirst(a, b) {
    return (parseTime(b) || 0) - (parseTime(a) || 0);
  }

  function dedupe(items, keyBuilder) {
    const seen = new Map();
    for (const item of items) {
      const key = keyBuilder(item);
      if (!seen.has(key)) seen.set(key, { item, repeats: 1 });
      else seen.get(key).repeats += 1;
    }
    return [...seen.values()];
  }

  function when(item) {
    const time = parseTime(item);
    return time === null ? 'Date unavailable' : new Date(time).toLocaleString();
  }

  function renderWork(items) {
    const target = byId('work');
    if (!target) return;
    const recent = (Array.isArray(items) ? items : []).filter(withinFiveDays).sort(newestFirst);
    const grouped = dedupe(recent, item => [item?.title || item?.id || '', item?.status || '', item?.area || '', item?.priority || ''].join('|'));
    target.innerHTML = grouped.length ? grouped.map(({item,repeats}) => {
      const repeat = repeats > 1 ? ` · ${repeats} updates` : '';
      return `<div class="row"><b>${esc(item.title || item.id || 'Work item')}</b><div class="muted">${esc(item.status || '')} · ${esc(item.area || '')} · P${esc(item.priority || '')}${esc(repeat)} · ${esc(when(item))}</div></div>`;
    }).join('') : `<div class="empty">No work recorded in the last ${RECENT_WINDOW_DAYS} days.</div>`;
  }

  function renderActivity(items) {
    const target = byId('activity');
    if (!target) return;
    const recent = (Array.isArray(items) ? items : []).filter(withinFiveDays).sort(newestFirst);
    const grouped = dedupe(recent, item => [item?.title || item?.type || '', item?.detail || ''].join('|'));
    target.innerHTML = grouped.length ? grouped.map(({item,repeats}) => {
      const repeat = repeats > 1 ? ` · repeated ${repeats}×` : '';
      return `<div class="row"><b>${esc(item.title || item.type || 'Activity')}</b><div class="muted">${esc(when(item))} · ${esc(item.detail || '')}${esc(repeat)}</div></div>`;
    }).join('') : `<div class="empty">No activity recorded in the last ${RECENT_WINDOW_DAYS} days.</div>`;
  }

  async function refreshRecentWindow() {
    if (applying) return;
    applying = true;
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) return;
      const state = await response.json();
      renderWork(state?.workQueue?.recentItems || []);
      renderActivity(state?.activityFeed || []);
    } catch (_) {
      // Leave the base dashboard rendering in place if this enhancement cannot refresh.
    } finally {
      setTimeout(() => { applying = false; }, 150);
    }
  }

  function scheduleRefresh() {
    if (applying || scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      refreshRecentWindow();
    }, 100);
  }

  for (const id of ['work','activity']) {
    const node = byId(id);
    if (node) new MutationObserver(scheduleRefresh).observe(node, { childList: true, subtree: true });
  }

  setTimeout(refreshRecentWindow, 250);
})();
