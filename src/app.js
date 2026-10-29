/**
 * Clarify — Context-Anchored AI Learning Interface
 *
 * Combines:
 *  1. Blank New-Thread state & persistent multi-thread notebook (`src/storage.js`)
 *  2. Interactive RSA Demo Thread (`src/router.js`) that runs locally & deterministically
 *  3. Full-height 50/50 desktop workbench & iOS mobile bottom sheet with drag-to-dismiss
 */

import { classifyPromptIntent } from './router.js';
import {
  DEMO_THREAD_ID,
  DEMO_SUGGESTIONS,
  isValidThreadId,
  loadThreadIndex,
  loadThreadData,
  saveThreadData,
  deleteThreadData,
  resetDemoThread
} from './storage.js';

export const state = {
  threadId: null, // null = Blank New Thread view
  threadTitle: 'New Thread',
  isDemo: false,
  activeBucketId: null,
  lastBucketId: null,
  expandedFoldedGroups: {},
  usedPrompts: new Set(),
  pendingSelection: null,
  buckets: {},
  mainMessages: []
};

const workspaceGrid = document.getElementById('workspace-grid');
const mainSpine = document.getElementById('main-spine');
const mainScroll = document.getElementById('main-scroll');
const chatStream = document.getElementById('chat-stream');
const bucketPanel = document.getElementById('bucket-panel');
const bucketPanelInner = document.getElementById('bucket-panel-inner');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const suggestionChips = document.getElementById('suggestion-chips');
const topbarTopicTitle = document.getElementById('topbar-topic-title');
const navThreadList = document.getElementById('nav-thread-list');
const btnOpenSidebar = document.getElementById('btn-open-sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnNewChat = document.getElementById('btn-new-chat');
const selectionClarifyBtn = document.getElementById('selection-clarify-btn');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/\u0000/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a strictly unique, sequential message ID (msg-1, msg-2, ...)
 */
function nextMessageId() {
  let maxNum = 0;
  for (const msg of state.mainMessages) {
    const match = /^msg-(\d+)$/.exec(msg.id);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `msg-${maxNum + 1}`;
}

/**
 * Read `?thread=<id>` from the browser URL (returns null on root `/` or if invalid)
 */
function getUrlThreadId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('thread');
    if (!raw) return null;
    if (!isValidThreadId(raw)) {
      syncUrlWithThread(null, { replace: true });
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Sync the browser URL bar (`/?thread=<id>` or `/`) with the active thread
 */
function syncUrlWithThread(threadId, { replace = false } = {}) {
  try {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('thread') || null;
    if (current === (threadId || null)) return;

    if (threadId) {
      url.searchParams.set('thread', threadId);
    } else {
      url.searchParams.delete('thread');
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (replace) {
      window.history.replaceState({ threadId }, '', nextUrl);
    } else {
      window.history.pushState({ threadId }, '', nextUrl);
    }
  } catch {
    // Ignore history restrictions in sandboxed environments
  }
}

/**
 * Persist the currently active thread to per-thread storage
 */
function persistCurrentThread() {
  if (!state.threadId || state.mainMessages.length === 0) return;
  saveThreadData({
    id: state.threadId,
    title: state.threadTitle,
    isDemo: state.isDemo,
    mainMessages: state.mainMessages,
    buckets: state.buckets,
    activeBucketId: state.activeBucketId,
    lastBucketId: state.lastBucketId,
    usedPrompts: Array.from(state.usedPrompts)
  });
}

/**
 * Switch to an existing thread by ID, or pass `null` to open the Blank New-Thread page
 */
function switchToThread(threadId, { fromPopState = false } = {}) {
  state.pendingSelection = null;
  state.expandedFoldedGroups = {};
  if (selectionClarifyBtn) selectionClarifyBtn.classList.add('hidden');

  if (!threadId) {
    state.threadId = null;
    state.threadTitle = 'New Thread';
    state.isDemo = false;
    state.activeBucketId = null;
    state.lastBucketId = null;
    state.usedPrompts = new Set();
    state.buckets = {};
    state.mainMessages = [];
    if (!fromPopState) syncUrlWithThread(null);
    render();
    return;
  }

  const loaded = loadThreadData(threadId);
  if (!loaded) {
    syncUrlWithThread(null, { replace: true });
    switchToThread(null, { fromPopState: true });
    return;
  }

  state.threadId = loaded.id;
  state.threadTitle = loaded.title || 'Learning Thread';
  state.isDemo = Boolean(loaded.isDemo);
  state.mainMessages = Array.isArray(loaded.mainMessages) ? loaded.mainMessages : [];
  state.buckets = loaded.buckets || {};
  state.activeBucketId = loaded.activeBucketId || null;
  state.lastBucketId = loaded.lastBucketId || null;
  state.usedPrompts = new Set(Array.isArray(loaded.usedPrompts) ? loaded.usedPrompts : []);
  if (!fromPopState) syncUrlWithThread(loaded.id);
  render();
}

/**
 * Highlight anchored phrases inside an assistant message's text
 */
function formatAssistantTextWithAnchors(msg) {
  let html = escapeHtml(msg.rawText);

  const msgBuckets = Object.values(state.buckets).filter((b) => b.parentMessageId === msg.id);

  for (const bucket of msgBuckets) {
    const safePhrase = escapeHtml(bucket.anchorPhrase);
    const isActive = state.activeBucketId === bucket.id && !bucket.folded;
    const count = bucket.items.length;
    const safeBucketId = escapeHtml(bucket.id);

    const replacement = `<mark class="concept-anchor ${isActive ? 'active-anchor' : ''}" data-bucket-id="${safeBucketId}">${safePhrase}<span class="bucket-pill-badge" data-bucket-id="${safeBucketId}">${count}</span></mark>`;

    const regex = new RegExp(safePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    html = html.replace(regex, () => replacement);
  }

  return html;
}

function foldActiveBucketState() {
  if (state.activeBucketId && state.buckets[state.activeBucketId]) {
    const parentMsgId = state.buckets[state.activeBucketId].parentMessageId;
    if (parentMsgId) {
      state.expandedFoldedGroups[parentMsgId] = false;
    }
    state.lastBucketId = state.activeBucketId;
    state.buckets[state.activeBucketId].folded = true;
    state.activeBucketId = null;
    return true;
  }
  return false;
}

/**
 * Fold any currently active bucket smoothly and close its parent summary pill
 */
function foldActiveBucket() {
  if (foldActiveBucketState()) {
    persistCurrentThread();
    render();
  }
}

/**
 * Render Sidebar Thread List
 */
function renderSidebarAndHeader() {
  if (topbarTopicTitle) {
    topbarTopicTitle.textContent = state.threadTitle || 'New Thread';
  }

  if (!navThreadList) return;
  const threads = loadThreadIndex();
  navThreadList.innerHTML = threads
    .map((t) => {
      const isActive = state.threadId === t.id;
      const label = t.isDemo ? `${t.title} (Demo)` : t.title;
      const actionTitle = t.isDemo ? 'Restart demo thread' : 'Delete thread';
      const actionIcon = t.isDemo
        ? `<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`
        : `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>`;

      return `
        <div class="nav-thread-row ${isActive ? 'active' : ''}">
          <button type="button" class="nav-thread-item" data-thread-id="${escapeHtml(t.id)}">
            ${escapeHtml(label)}
          </button>
          <button type="button" class="nav-thread-delete" data-delete-thread="${escapeHtml(t.id)}" title="${actionTitle}" aria-label="${actionTitle}">
            ${actionIcon}
          </button>
        </div>
      `;
    })
    .join('');
}

/**
 * Render Suggestion Chips ONLY when inside the Interactive Demo Thread
 */
function renderSuggestionChips() {
  if (!suggestionChips) return;

  if (!state.isDemo || state.mainMessages.length === 0) {
    suggestionChips.classList.add('hidden');
    suggestionChips.innerHTML = '';
    return;
  }

  const available = DEMO_SUGGESTIONS.filter((p) => !state.usedPrompts.has(p));
  if (available.length === 0) {
    suggestionChips.classList.add('hidden');
    suggestionChips.innerHTML = '';
    return;
  }

  suggestionChips.classList.remove('hidden');
  suggestionChips.innerHTML = available
    .map(
      (p) => `
      <button type="button" class="try-chip" data-prompt="${escapeHtml(p)}">
        ${escapeHtml(p)}
      </button>`
    )
    .join('');
}

/**
 * Render the Main Learning Spine (or Blank Welcome State) & any active Tethered Side-Panel Bucket
 */
function render(options = {}) {
  renderSidebarAndHeader();
  renderSuggestionChips();

  const isEmptyThread = state.mainMessages.length === 0;
  mainSpine.classList.toggle('is-empty-thread', isEmptyThread);

  if (isEmptyThread) {
    chatStream.innerHTML = `
      <div class="empty-thread-state">
        <h1 class="empty-state-title">Where should we begin?</h1>
      </div>
    `;
  } else {
    chatStream.innerHTML = state.mainMessages
      .map((msg, idx) => {
        if (msg.role === 'user') {
          return `<div class="msg-card msg-user">${escapeHtml(msg.rawText)}</div>`;
        }

        const foldedBuckets = Object.values(state.buckets).filter(
          (b) => b.parentMessageId === msg.id && b.folded && b.items.length > 0
        );

        const isGroupExpanded = Boolean(state.expandedFoldedGroups[msg.id]);
        const countLabel =
          foldedBuckets.length === 1
            ? '1 Clarification'
            : `${foldedBuckets.length} Clarifications`;
        const previewNames = foldedBuckets.map((b) => escapeHtml(b.anchorPhrase)).join(', ');
        const safeMsgId = escapeHtml(msg.id);

        const foldedHtml =
          foldedBuckets.length > 0
            ? `<div class="folded-buckets-group ${isGroupExpanded ? 'is-expanded' : ''}">
                <button type="button" class="folded-group-toggle" data-toggle-group="${safeMsgId}" aria-expanded="${isGroupExpanded}">
                  <span class="folded-group-meta">
                    <span class="folded-group-count">${countLabel}</span>
                    <span class="folded-group-dot">·</span>
                    <span class="folded-group-names">${previewNames}</span>
                  </span>
                  <svg class="folded-group-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="folded-group-list">
                  <div class="folded-group-list-inner">
                    ${foldedBuckets
                      .map(
                        (b) => `
                      <div class="folded-summary-item" data-bucket-id="${escapeHtml(b.id)}">
                        <span><strong>${escapeHtml(b.anchorPhrase)}</strong> — ${escapeHtml(b.takeaway)}</span>
                        <span class="folded-open-label">View (${b.items.length}) →</span>
                      </div>`
                      )
                      .join('')}
                  </div>
                </div>
              </div>`
            : '';

        const canMoveToBucket =
          Boolean(msg.originBucketMeta) && state.mainMessages[idx - 1]?.role === 'user';
        const moveBackHtml = canMoveToBucket
          ? `<div class="msg-main-actions">
              <button type="button" class="btn btn-secondary btn-demote-bucket" data-msg-id="${safeMsgId}">
                ↘ Move to Clarification Bucket
              </button>
            </div>`
          : '';

        return `
          <article class="msg-card msg-assistant" data-msg-id="${safeMsgId}">
            <div class="msg-body">
              <p>${formatAssistantTextWithAnchors(msg)}</p>
            </div>
            ${moveBackHtml}
            ${foldedHtml}
          </article>
        `;
      })
      .join('');
  }

  // Render Side-Panel Bucket if one is open
  const activeBucket = state.activeBucketId ? state.buckets[state.activeBucketId] : null;
  if (activeBucket && !activeBucket.folded && activeBucket.items.length > 0) {
    workspaceGrid.classList.add('has-open-bucket');
    bucketPanel.setAttribute('aria-hidden', 'false');

    bucketPanelInner.innerHTML = `
      <div class="sheet-grab-bar" id="sheet-grab-bar" title="Close panel">
        <span class="sheet-grab-pill"></span>
      </div>
      <div class="bucket-header">
        <div class="bucket-header-title">
          <span class="bucket-concept-name">Clarification</span>
        </div>
        <div class="bucket-actions">
          <button type="button" class="btn-icon btn-icon-close" id="btn-fold-bucket" title="Close panel (Esc)" aria-label="Close panel">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <div class="bucket-thread" id="bucket-thread">
        <div class="bucket-summary-bubble">
          <span class="bucket-summary-label">Summary</span>
          <p>${escapeHtml(activeBucket.takeaway)}</p>
        </div>

        ${activeBucket.items
          .map(
            (item, idx) => `
          <div class="bucket-qa-card">
            <div class="bucket-q">${escapeHtml(item.question)}</div>
            <div class="bucket-a">${escapeHtml(item.answer)}</div>
            <div class="bucket-card-footer">
              <button type="button" class="btn btn-secondary btn-promote-main" data-bucket-id="${escapeHtml(activeBucket.id)}" data-item-idx="${idx}">
                ↖ Move to Main Chat
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="bucket-footer">
        <form id="bucket-form" class="bucket-form" data-bucket-id="${escapeHtml(activeBucket.id)}">
          <textarea
            id="bucket-input"
            class="bucket-input"
            rows="1"
            placeholder="Ask a follow-up on ${escapeHtml(activeBucket.anchorPhrase)}..."
            autocomplete="off"
          ></textarea>
          <button type="submit" class="btn btn-primary bucket-submit">Ask</button>
        </form>
      </div>
    `;

    const bucketThread = document.getElementById('bucket-thread');
    if (bucketThread) {
      if (options.scrollBucketToBottom) {
        bucketThread.scrollTo({
          top: bucketThread.scrollHeight,
          behavior: 'smooth'
        });
      } else {
        bucketThread.scrollTop = 0;
      }
    }

    if (window.matchMedia('(max-width: 860px)').matches) {
      const activeMark = chatStream.querySelector('.concept-anchor.active-anchor');
      if (activeMark) {
        requestAnimationFrame(() => {
          const markRect = activeMark.getBoundingClientRect();
          const targetOffset = window.scrollY + markRect.top - 64;
          window.scrollTo({
            top: Math.max(0, targetOffset),
            behavior: 'smooth'
          });
        });
      }
    }
  } else {
    workspaceGrid.classList.remove('has-open-bucket');
    bucketPanel.setAttribute('aria-hidden', 'true');
    bucketPanel.style.transform = '';
    bucketPanel.style.transition = '';
  }

  if (options.scrollMainToBottom) {
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 860px)').matches) {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth'
        });
      } else if (mainScroll) {
        mainScroll.scrollTo({
          top: mainScroll.scrollHeight,
          behavior: 'smooth'
        });
      }
    });
  }
}

/**
 * Open or append to a Clarification Bucket
 */
function upsertAndOpenBucket({ targetMessageId, anchorPhrase, takeaway, question, answer }) {
  let bucket = Object.values(state.buckets).find(
    (b) =>
      b.parentMessageId === targetMessageId &&
      b.anchorPhrase.toLowerCase() === anchorPhrase.toLowerCase()
  );

  if (!bucket) {
    const id = 'bucket-' + (Object.keys(state.buckets).length + 1) + '-' + Date.now();
    bucket = {
      id,
      parentMessageId: targetMessageId,
      anchorPhrase,
      takeaway: takeaway || `${anchorPhrase}: clarified in context.`,
      folded: false,
      items: [],
      drilldownAnswer: `Concrete example for "${anchorPhrase}": Suppose p = 3 and q = 11, so n = 33 and φ(n) = (3 - 1)(11 - 1) = 20. If we pick e = 3, then d = 7 because (3 × 7) = 21, and 21 mod 20 = 1.`
    };
    state.buckets[id] = bucket;
  } else if (takeaway) {
    bucket.takeaway = takeaway;
  }

  bucket.folded = false;
  bucket.items.push({ question, answer });
  state.activeBucketId = bucket.id;
  state.lastBucketId = bucket.id;
  persistCurrentThread();
  render();
}

/**
 * Handle submitting a follow-up question directly inside the open Bucket's input bar
 */
function handleBucketFollowUp(bucketId, text) {
  const clean = text.trim();
  if (!clean) return;

  const bucket = state.buckets[bucketId];
  if (!bucket) return;

  bucket.items.push({
    question: clean,
    answer:
      bucket.drilldownAnswer ||
      `Follow-up on "${bucket.anchorPhrase}": Suppose p = 3 and q = 11, so n = 33 and φ(n) = (3 - 1)(11 - 1) = 20. If we pick e = 3, then d = 7 because (3 × 7) = 21, and 21 mod 20 = 1.`
  });

  persistCurrentThread();
  render({ scrollBucketToBottom: true });
}

/**
 * Handle submitting a prompt in the main bottom input bar
 */
function handlePromptSubmit(text) {
  const clean = text.trim();
  if (!clean) return;

  if (!state.threadId) {
    resetDemoThread();
    switchToThread(DEMO_THREAD_ID);
  }

  state.usedPrompts.add(clean);

  const decision = classifyPromptIntent(
    clean,
    state.mainMessages,
    state.buckets,
    state.activeBucketId,
    state.lastBucketId
  );

  if (decision.intent === 'CLARIFICATION') {
    upsertAndOpenBucket({
      targetMessageId: decision.targetMessageId,
      anchorPhrase: decision.anchorPhrase,
      takeaway: decision.takeaway,
      question: clean,
      answer: decision.cannedAnswer
    });
    return;
  }

  if (decision.intent === 'BUCKET_DRILLDOWN') {
    const bucket = state.buckets[decision.bucketId];
    bucket.folded = false;
    state.activeBucketId = bucket.id;
    state.lastBucketId = bucket.id;
    bucket.items.push({
      question: clean,
      answer: decision.cannedAnswer
    });
    persistCurrentThread();
    render({ scrollBucketToBottom: true });
    return;
  }

  foldActiveBucketState();

  state.mainMessages.push({
    id: nextMessageId(),
    role: 'user',
    rawText: clean
  });

  state.mainMessages.push({
    id: nextMessageId(),
    role: 'assistant',
    rawText:
      'Now that your key pair is ready, RSA encryption and decryption are straightforward: To encrypt a message M, the sender computes ciphertext C = M^e mod n. To decrypt C back into M, the receiver uses their private key d to compute M = C^d mod n.',
    concepts: [
      {
        key: 'ciphertext',
        phrase: 'ciphertext C = M^e mod n',
        keywords: ['ciphertext', 'encrypt', 'm^e'],
        explanation:
          'Raising message M to the power e modulo n scrambles the message so anyone intercepting C only sees a remainder between 0 and n - 1.',
        takeaway: 'Encryption scrambles M using public key (e, n).'
      }
    ]
  });

  persistCurrentThread();
  render({ scrollMainToBottom: true });
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const maxHeight = 148;
  const nextHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function resetTextareaHeight(el) {
  if (!el) return;
  el.style.height = '';
  el.style.overflowY = 'hidden';
}

promptForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = promptInput.value;
  promptInput.value = '';
  resetTextareaHeight(promptInput);
  handlePromptSubmit(val);
});

promptInput.addEventListener('input', () => {
  autoResizeTextarea(promptInput);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    promptForm.requestSubmit();
  }
});

suggestionChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.try-chip');
  if (!btn) return;
  e.stopPropagation();
  handlePromptSubmit(btn.dataset.prompt);
});

function toggleSidebar(forceOpen) {
  const isOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : !workspaceGrid.classList.contains('is-sidebar-open');
  workspaceGrid.classList.toggle('is-sidebar-open', isOpen);
}

if (btnOpenSidebar) {
  btnOpenSidebar.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
}

if (btnCloseSidebar) {
  btnCloseSidebar.addEventListener('click', () => toggleSidebar(false));
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));
}

if (btnNewChat) {
  btnNewChat.addEventListener('click', () => {
    toggleSidebar(false);
    switchToThread(null);
  });
}

if (navThreadList) {
  navThreadList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete-thread]');
    if (deleteBtn) {
      e.stopPropagation();
      const targetId = deleteBtn.getAttribute('data-delete-thread');
      deleteThreadData(targetId);
      if (targetId === DEMO_THREAD_ID && state.threadId === DEMO_THREAD_ID) {
        switchToThread(DEMO_THREAD_ID);
      } else if (state.threadId === targetId) {
        switchToThread(null);
      } else {
        renderSidebarAndHeader();
      }
      return;
    }

    const threadBtn = e.target.closest('[data-thread-id]');
    if (threadBtn) {
      const targetId = threadBtn.getAttribute('data-thread-id');
      toggleSidebar(false);
      switchToThread(targetId);
    }
  });
}

function hideSelectionPill() {
  state.pendingSelection = null;
  if (selectionClarifyBtn) {
    selectionClarifyBtn.classList.add('hidden');
  }
}

let selectionRafId = 0;

document.addEventListener('selectionchange', () => {
  if (!selectionClarifyBtn) return;
  if (selectionRafId) cancelAnimationFrame(selectionRafId);

  selectionRafId = requestAnimationFrame(() => {
    selectionRafId = 0;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hideSelectionPill();
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 3 || text.length > 90) {
      hideSelectionPill();
      return;
    }

    const range = sel.getRangeAt(0);
    const startContainer =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;

    const assistantCard = startContainer?.closest('.msg-assistant');
    if (
      !assistantCard ||
      startContainer.closest('.folded-buckets-group') ||
      startContainer.closest('.msg-main-actions')
    ) {
      hideSelectionPill();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideSelectionPill();
      return;
    }

    const msgId = assistantCard.getAttribute('data-msg-id');
    state.pendingSelection = { msgId, text };

    const top = Math.max(44, rect.top - 8);
    const left = Math.min(window.innerWidth - 60, Math.max(60, rect.left + rect.width / 2));

    selectionClarifyBtn.style.top = `${top}px`;
    selectionClarifyBtn.style.left = `${left}px`;
    selectionClarifyBtn.classList.remove('hidden');
  });
});

if (selectionClarifyBtn) {
  selectionClarifyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  selectionClarifyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const pending = state.pendingSelection;
    if (!pending) return;

    const msg = state.mainMessages.find((m) => m.id === pending.msgId);
    if (!msg) return;

    window.getSelection()?.removeAllRanges();
    hideSelectionPill();

    const lowerSel = pending.text.toLowerCase();
    const matchedConcept = (msg.concepts || []).find(
      (c) =>
        c.phrase.toLowerCase().includes(lowerSel) ||
        lowerSel.includes(c.phrase.toLowerCase()) ||
        c.keywords.some((kw) => lowerSel.includes(kw.toLowerCase()))
    );

    const anchorPhrase = matchedConcept ? matchedConcept.phrase : pending.text;
    const question = `Clarify "${anchorPhrase}"`;
    const answer = matchedConcept
      ? matchedConcept.explanation
      : `"${anchorPhrase}" refers to a key building block in this step: isolating how "${anchorPhrase}" works here lets you inspect its exact role without derailing the main lesson thread.`;
    const takeaway = matchedConcept
      ? matchedConcept.takeaway
      : `${anchorPhrase}: key concept clarified in context.`;

    upsertAndOpenBucket({
      targetMessageId: msg.id,
      anchorPhrase,
      takeaway,
      question,
      answer
    });
  });
}

document.addEventListener('submit', (e) => {
  const bForm = e.target.closest('#bucket-form');
  if (!bForm) return;
  e.preventDefault();
  const bInput = bForm.querySelector('#bucket-input');
  if (!bInput) return;
  const val = bInput.value;
  bInput.value = '';
  resetTextareaHeight(bInput);
  handleBucketFollowUp(bForm.dataset.bucketId, val);
});

document.addEventListener('input', (e) => {
  const bInput = e.target.closest('#bucket-input');
  if (bInput) {
    autoResizeTextarea(bInput);
  }
});

document.addEventListener('keydown', (e) => {
  const bInput = e.target.closest('#bucket-input');
  if (bInput && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const bForm = bInput.closest('#bucket-form');
    if (bForm) bForm.requestSubmit();
  }
});

mainSpine.addEventListener('click', (e) => {
  if (!state.activeBucketId) return;
  if (!mainSpine.contains(e.target)) return;
  if (e.target.closest('.prompt-dock')) return;
  if (e.target.closest('[data-bucket-id]') || e.target.closest('[data-toggle-group]')) return;

  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) return;

  foldActiveBucket();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeBucketId) {
    foldActiveBucket();
  }
});

let sheetDragState = null;

bucketPanel.addEventListener(
  'touchstart',
  (e) => {
    if (!window.matchMedia('(max-width: 860px)').matches || !state.activeBucketId) return;
    if (e.touches.length !== 1) return;

    const fromHeader = Boolean(
      e.target.closest('#sheet-grab-bar') || e.target.closest('.bucket-header')
    );
    const bucketThread = document.getElementById('bucket-thread');
    const atTopOfThread = bucketThread ? bucketThread.scrollTop <= 0 : true;

    if (!fromHeader && !atTopOfThread) return;

    sheetDragState = {
      startY: e.touches[0].clientY,
      currentDeltaY: 0,
      fromHeader,
      isDragging: false
    };
  },
  { passive: true }
);

bucketPanel.addEventListener(
  'touchmove',
  (e) => {
    if (!sheetDragState) return;
    const deltaY = e.touches[0].clientY - sheetDragState.startY;

    if (deltaY <= 0) {
      if (sheetDragState.isDragging) {
        bucketPanel.style.transform = 'translateY(0)';
      }
      sheetDragState.currentDeltaY = 0;
      return;
    }

    if (deltaY > 6) {
      sheetDragState.isDragging = true;
      sheetDragState.currentDeltaY = deltaY;
      bucketPanel.style.transition = 'none';
      bucketPanel.style.transform = `translateY(${deltaY}px)`;
      if (e.cancelable) e.preventDefault();
    }
  },
  { passive: false }
);

function finishSheetDrag() {
  if (!sheetDragState) return;
  const { isDragging, currentDeltaY } = sheetDragState;
  sheetDragState = null;

  if (!isDragging) return;

  bucketPanel.style.transition = '';
  if (currentDeltaY > 85) {
    bucketPanel.style.transform = '';
    foldActiveBucket();
  } else {
    bucketPanel.style.transform = 'translateY(0)';
    setTimeout(() => {
      if (state.activeBucketId) bucketPanel.style.transform = '';
    }, 420);
  }
}

bucketPanel.addEventListener('touchend', finishSheetDrag);
bucketPanel.addEventListener('touchcancel', finishSheetDrag);

document.addEventListener('click', (e) => {
  const groupToggle = e.target.closest('[data-toggle-group]');
  if (groupToggle) {
    const msgId = groupToggle.getAttribute('data-toggle-group');
    state.expandedFoldedGroups[msgId] = !state.expandedFoldedGroups[msgId];
    render();
    return;
  }

  if (e.target.closest('#btn-fold-bucket') || e.target.closest('#sheet-grab-bar')) {
    foldActiveBucket();
    return;
  }

  const anchorEl = e.target.closest('[data-bucket-id]');
  if (anchorEl && !e.target.closest('.btn-promote-main') && !e.target.closest('#bucket-form')) {
    const bId = anchorEl.getAttribute('data-bucket-id');
    if (state.buckets[bId]) {
      if (state.activeBucketId === bId && !state.buckets[bId].folded) {
        foldActiveBucket();
      } else {
        state.buckets[bId].folded = false;
        state.activeBucketId = bId;
        persistCurrentThread();
        render();
      }
    }
    return;
  }

  const promoteBtn = e.target.closest('.btn-promote-main');
  if (promoteBtn) {
    const bId = promoteBtn.getAttribute('data-bucket-id');
    const idx = Number(promoteBtn.getAttribute('data-item-idx'));
    const bucket = state.buckets[bId];
    if (bucket && bucket.items[idx]) {
      const [removed] = bucket.items.splice(idx, 1);
      const bucketMeta = {
        id: bucket.id,
        parentMessageId: bucket.parentMessageId,
        anchorPhrase: bucket.anchorPhrase,
        takeaway: bucket.takeaway,
        drilldownAnswer: bucket.drilldownAnswer
      };
      state.mainMessages.push({ id: nextMessageId(), role: 'user', rawText: removed.question });
      state.mainMessages.push({
        id: nextMessageId(),
        role: 'assistant',
        rawText: removed.answer,
        originBucketMeta: bucketMeta
      });
      if (bucket.items.length === 0) {
        delete state.buckets[bId];
        state.activeBucketId = null;
      }
      persistCurrentThread();
      render({ scrollMainToBottom: true });
    }
    return;
  }

  const demoteBtn = e.target.closest('.btn-demote-bucket');
  if (demoteBtn) {
    const msgId = demoteBtn.getAttribute('data-msg-id');
    const aIdx = state.mainMessages.findIndex((m) => m.id === msgId);
    if (aIdx > 0 && state.mainMessages[aIdx - 1]?.role === 'user') {
      const userMsg = state.mainMessages[aIdx - 1];
      const assistantMsg = state.mainMessages[aIdx];
      if (!assistantMsg.originBucketMeta) return;

      state.mainMessages.splice(aIdx - 1, 2);

      const meta = assistantMsg.originBucketMeta;
      if (!state.buckets[meta.id]) {
        state.buckets[meta.id] = {
          ...meta,
          folded: false,
          items: []
        };
      }
      const targetBucket = state.buckets[meta.id];
      targetBucket.folded = false;
      targetBucket.items.push({
        question: userMsg.rawText,
        answer: assistantMsg.rawText
      });
      state.activeBucketId = targetBucket.id;
      state.lastBucketId = targetBucket.id;
      persistCurrentThread();
      render();
    }
  }
});

loadThreadIndex();
switchToThread(getUrlThreadId(), { fromPopState: true });

window.addEventListener('popstate', () => {
  switchToThread(getUrlThreadId(), { fromPopState: true });
});
