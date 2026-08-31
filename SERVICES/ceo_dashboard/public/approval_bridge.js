"use strict";

(function () {
  function missionIdFromCard() {
    const link = document.querySelector('#commandResult a[href*="/execution?operationId="]');
    if (!link) return null;
    try {
      const url = new URL(link.href, window.location.origin);
      return url.searchParams.get('operationId');
    } catch {
      return null;
    }
  }

  async function postApproval(operationId) {
    const ok = window.confirm(`Approve this MILES operation?\n\n${operationId}\n\nOnly approve if this is the operation you just reviewed.`);
    if (!ok) return;

    const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '', instructions: '' }),
      cache: 'no-store'
    });

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok) {
      throw new Error((data && (data.error || data.message)) || text || `HTTP ${response.status}`);
    }

    window.alert(data?.message || `Approving operation completed: ${data?.status || 'OK'}`);
    window.location.reload();
  }

  function bindDirectApproval() {
    const button = document.getElementById('reviewCommandApproval');
    if (!button || button.dataset.directApprovalBound === 'true') return;

    button.dataset.directApprovalBound = 'true';
    button.textContent = 'Review / Approve';
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const operationId = missionIdFromCard();
      if (!operationId) {
        window.alert('MILES could not resolve the operation ID from this mission card. Open View Mission and retry.');
        return;
      }
      try {
        await postApproval(operationId);
      } catch (error) {
        window.alert(`Approving operation failed: ${error.message}`);
      }
    }, true);
  }

  function relabelRuntimeBacklog() {
    const alerts = document.getElementById('alerts');
    if (!alerts) return;
    for (const row of alerts.querySelectorAll('.row')) {
      const text = row.textContent || '';
      if (!text.includes('Worker runtime approval backlog')) continue;
      const bold = row.querySelector('b');
      const detail = row.querySelector('.muted');
      if (bold) bold.textContent = 'INFO · Runtime approval records pending reconciliation';
      if (detail) detail.textContent = 'Worker-runtime approval records are not additional CEO decisions unless they map to a current canonical approval. Already-decided records should be reconciled automatically.';
    }
  }

  const observer = new MutationObserver(() => {
    bindDirectApproval();
    relabelRuntimeBacklog();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  bindDirectApproval();
  relabelRuntimeBacklog();
})();
