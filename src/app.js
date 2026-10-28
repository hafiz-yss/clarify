/**
 * Clarify — Context-Anchored AI Learning Interface
 *
 * Demonstrates:
 *  1. Typing naturally in the bottom prompt bar (or dedicated bucket follow-up input)
 *  2. Automatic detection of Clarifications vs. Main Thread Progression
 *  3. Automatic highlighting of the anchor phrase in the parent lesson
 *  4. Smooth opening & closing of the tethered Side-Panel Bucket
 *  5. Clicking back on the Main Chat space (or pressing Esc) naturally folds the bucket
 */

import { classifyPromptIntent } from './router.js';

const INITIAL_MESSAGES = [
  {
    id: 'msg-1',
    role: 'user',
    rawText: 'Explain how RSA Public-Key Cryptography generates keys.'
  },
  {
    id: 'msg-2',
    role: 'assistant',
    rawText:
      "To generate an RSA key pair, your computer performs three core mathematical steps: First, it picks two large random prime numbers (p and q) and multiplies them to produce the public modulus n = p * q. Second, it computes Euler's totient function φ(n) = (p - 1)(q - 1), which counts how many positive integers up to n are coprime to n. Third, it chooses a public exponent e and calculates the private key d as the modular multiplicative inverse of e modulo φ(n).",
    concepts: [
      {
        key: 'totient',
        phrase: "Euler's totient function",
        keywords: ['totient', 'euler', 'phi', 'coprime'],
        explanation:
          "Euler's totient function φ(n) simply counts how many numbers less than n share no common factors with n. Because p and q are prime, it's easy to compute if you know p and q: just (p - 1) × (q - 1). Without knowing p and q, it is practically impossible to calculate for huge numbers.",
        takeaway: 'φ(n) = (p - 1)(q - 1); easy with primes p & q, infeasible without them.'
      },
      {
        key: 'inverse',
        phrase: 'modular multiplicative inverse',
        keywords: ['inverse', 'modular', 'multiplicative', 'private key d', 'modulo'],
        explanation:
          'A modular multiplicative inverse d is the "undo button" for multiplication under clock arithmetic. When you multiply your public exponent e by d and divide by φ(n), the remainder is 1: (e × d) mod φ(n) = 1.',
        takeaway: 'Private key d reverses public exponent e: (e × d) mod φ(n) = 1.'
      },
      {
        key: 'modulus',
        phrase: 'public modulus n = p * q',
        keywords: ['modulus', 'prime', 'primes', 'multiply'],
        explanation:
          'Multiplying two primes (like 61 × 53 = 3233) takes microseconds, but factoring a 2048-bit modulus n back into p and q would take a classical supercomputer thousands of years. This one-way trapdoor is what makes RSA secure.',
        takeaway: 'Multiplying p × q is instant; factoring n back into p & q is infeasible.'
      }
    ]
  }
];

export const state = {
  activeBucketId: null,
  lastBucketId: null,
  expandedFoldedGroups: {},
  usedPrompts: new Set(),
  pendingSelection: null,
  buckets: {},
  mainMessages: structuredClone(INITIAL_MESSAGES)
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
const btnOpenSidebar = document.getElementById('btn-open-sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnNewChat = document.getElementById('btn-new-chat');
const selectionClarifyBtn = document.getElementById('selection-clarify-btn');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

    const replacement = `<mark class="concept-anchor ${isActive ? 'active-anchor' : ''}" data-bucket-id="${bucket.id}">${safePhrase}<span class="bucket-pill-badge" data-bucket-id="${bucket.id}">${count}</span></mark>`;

    const regex = new RegExp(safePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    html = html.replace(regex, replacement);
  }

  return `<p>${html}</p>`;
}

/**
 * Fold any currently active bucket smoothly
 */
function foldActiveBucket() {
  if (state.activeBucketId && state.buckets[state.activeBucketId]) {
    const parentMsgId = state.buckets[state.activeBucketId].parentMessageId;
    if (parentMsgId) {
      state.expandedFoldedGroups[parentMsgId] = false;
    }
    state.lastBucketId = state.activeBucketId;
    state.buckets[state.activeBucketId].folded = true;
    state.activeBucketId = null;
    render();
  }
}

/**
 * Render the Main Learning Spine & any active Tethered Side-Panel Bucket
 */
function render(options = {}) {
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
        foldedBuckets.length === 1 ? '1 Clarification' : `${foldedBuckets.length} Clarifications`;
      const previewNames = foldedBuckets.map((b) => escapeHtml(b.anchorPhrase)).join(', ');

      const foldedHtml =
        foldedBuckets.length > 0
          ? `<div class="folded-buckets-group ${isGroupExpanded ? 'is-expanded' : ''}">
              <button type="button" class="folded-group-toggle" data-toggle-group="${msg.id}" aria-expanded="${isGroupExpanded}">
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
                    <div class="folded-summary-item" data-bucket-id="${b.id}">
                      <span><strong>${escapeHtml(b.anchorPhrase)}</strong> — ${escapeHtml(b.takeaway)}</span>
                      <span class="folded-open-label">View (${b.items.length}) →</span>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>
            </div>`
          : '';

      // Only Q&A pairs that were moved out of a bucket can be sent back to it
      const canMoveToBucket =
        Boolean(msg.originBucketMeta) && state.mainMessages[idx - 1]?.role === 'user';
      const moveBackHtml = canMoveToBucket
        ? `<div class="msg-main-actions">
            <button type="button" class="btn btn-secondary btn-demote-bucket" data-msg-id="${msg.id}">
              ↘ Move to Clarification Bucket
            </button>
          </div>`
        : '';

      return `
        <article class="msg-card msg-assistant" data-msg-id="${msg.id}">
          <div class="msg-body">
            ${formatAssistantTextWithAnchors(msg)}
          </div>
          ${moveBackHtml}
          ${foldedHtml}
        </article>
      `;
    })
    .join('');

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
              <button type="button" class="btn btn-secondary btn-promote-main" data-bucket-id="${activeBucket.id}" data-item-idx="${idx}">
                ↖ Move to Main Chat
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="bucket-footer">
        <form id="bucket-form" class="bucket-form" data-bucket-id="${activeBucket.id}">
          <input
            type="text"
            id="bucket-input"
            class="bucket-input"
            placeholder="Ask a follow-up on ${escapeHtml(activeBucket.anchorPhrase)}..."
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary bucket-submit">Ask</button>
        </form>
      </div>
    `;

    const bucketThread = document.getElementById('bucket-thread');
    if (bucketThread) {
      bucketThread.scrollTo({
        top: bucketThread.scrollHeight,
        behavior: 'smooth'
      });
    }

    // On mobile/narrow viewports, smoothly scroll the active anchor into the top 22% peek window
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
    // Smoothly animate closed without clearing inner DOM until transition completes
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

  // Progressive disclosure: hide used suggestion chips
  if (suggestionChips) {
    const chips = suggestionChips.querySelectorAll('.try-chip');
    let visibleCount = 0;
    chips.forEach((chip) => {
      const isUsed = state.usedPrompts.has(chip.dataset.prompt);
      chip.classList.toggle('hidden', isUsed);
      if (!isUsed) visibleCount++;
    });
    suggestionChips.classList.toggle('hidden', visibleCount === 0);
  }
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

  render();
}

/**
 * Handle submitting a prompt in the main bottom input bar
 */
function handlePromptSubmit(text) {
  const clean = text.trim();
  if (!clean) return;

  const decision = classifyPromptIntent(
    clean,
    state.mainMessages,
    state.buckets,
    state.activeBucketId,
    state.lastBucketId
  );

  if (decision.intent === 'CLARIFICATION') {
    let bucket = Object.values(state.buckets).find(
      (b) =>
        b.parentMessageId === decision.targetMessageId &&
        b.anchorPhrase.toLowerCase() === decision.anchorPhrase.toLowerCase()
    );

    if (!bucket) {
      const id = 'bucket-' + (Object.keys(state.buckets).length + 1);
      bucket = {
        id,
        parentMessageId: decision.targetMessageId,
        anchorPhrase: decision.anchorPhrase,
        takeaway: decision.takeaway || `Clarified concept: ${decision.anchorPhrase}`,
        folded: false,
        items: [],
        drilldownAnswer:
          `Concrete numeric example for "${decision.anchorPhrase}": Suppose p = 3 and q = 11, so n = 33 and φ(n) = (3 - 1)(11 - 1) = 20. If we pick e = 3, then d = 7 because (3 × 7) = 21, and 21 mod 20 = 1.`
      };
      state.buckets[id] = bucket;
    }

    bucket.folded = false;
    bucket.items.push({
      question: clean,
      answer: decision.cannedAnswer
    });
    state.activeBucketId = bucket.id;
    state.lastBucketId = bucket.id;
    render();
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
    render();
    return;
  }

  // Main Progression: Auto-fold any open bucket and continue the main lesson spine
  if (state.activeBucketId && state.buckets[state.activeBucketId]) {
    const parentMsgId = state.buckets[state.activeBucketId].parentMessageId;
    if (parentMsgId) {
      state.expandedFoldedGroups[parentMsgId] = false;
    }
    state.lastBucketId = state.activeBucketId;
    state.buckets[state.activeBucketId].folded = true;
    state.activeBucketId = null;
  }

  state.mainMessages.push({
    id: 'msg-' + (state.mainMessages.length + 1),
    role: 'user',
    rawText: clean
  });

  state.mainMessages.push({
    id: 'msg-' + (state.mainMessages.length + 1),
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

  render({ scrollMainToBottom: true });
}

// Event Listeners
promptForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = promptInput.value;
  promptInput.value = '';
  handlePromptSubmit(val);
});

suggestionChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.try-chip');
  if (!btn) return;
  const promptText = btn.dataset.prompt;
  state.usedPrompts.add(promptText);
  handlePromptSubmit(promptText);
});

// Sidebar open/close & "+ New Thread" logic
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
    state.activeBucketId = null;
    state.lastBucketId = null;
    state.expandedFoldedGroups = {};
    state.usedPrompts.clear();
    state.pendingSelection = null;
    state.buckets = {};
    state.mainMessages = structuredClone(INITIAL_MESSAGES);
    if (selectionClarifyBtn) selectionClarifyBtn.classList.add('hidden');
    toggleSidebar(false);
    render();
  });
}

// Floating Text-Selection "Clarify ↗" Pill logic
function hideSelectionPill() {
  state.pendingSelection = null;
  if (selectionClarifyBtn) {
    selectionClarifyBtn.classList.add('hidden');
  }
}

document.addEventListener('selectionchange', () => {
  if (!selectionClarifyBtn) return;
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
  // Only show when selecting inside the main lesson body (not inside folded bars or buttons)
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

if (selectionClarifyBtn) {
  selectionClarifyBtn.addEventListener('mousedown', (e) => {
    // Prevent mousedown from collapsing the text selection before click fires
    e.preventDefault();
    e.stopPropagation();
  });

  selectionClarifyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const pending = state.pendingSelection;
    if (!pending) return;

    const msg = state.mainMessages.find((m) => m.id === pending.msgId);
    if (!msg) return;

    // Check if the selected text overlaps one of the message's pre-defined concepts
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

    let bucket = Object.values(state.buckets).find(
      (b) =>
        b.parentMessageId === msg.id &&
        b.anchorPhrase.toLowerCase() === anchorPhrase.toLowerCase()
    );

    if (!bucket) {
      const id = 'bucket-' + (Object.keys(state.buckets).length + 1);
      bucket = {
        id,
        parentMessageId: msg.id,
        anchorPhrase,
        takeaway,
        folded: false,
        items: [],
        drilldownAnswer:
          `Concrete numeric example for "${anchorPhrase}": Suppose p = 3 and q = 11, so n = 33 and φ(n) = (3 - 1)(11 - 1) = 20. If we pick e = 3, then d = 7 because (3 × 7) = 21, and 21 mod 20 = 1.`
      };
      state.buckets[id] = bucket;
    }

    bucket.folded = false;
    bucket.items.push({ question, answer });
    state.activeBucketId = bucket.id;
    state.lastBucketId = bucket.id;

    window.getSelection()?.removeAllRanges();
    hideSelectionPill();
    render();
  });
}

// Delegated submit listener for the dedicated Bucket follow-up form
document.addEventListener('submit', (e) => {
  const bForm = e.target.closest('#bucket-form');
  if (!bForm) return;
  e.preventDefault();
  const bInput = bForm.querySelector('#bucket-input');
  if (!bInput) return;
  const val = bInput.value;
  bInput.value = '';
  handleBucketFollowUp(bForm.dataset.bucketId, val);
});

// Click on the Main Scroll canvas (outside the prompt dock) to smoothly close the open bucket
mainSpine.addEventListener('click', (e) => {
  if (!state.activeBucketId) return;

  // Never close when clicking inside the bottom prompt dock (input, submit button, or suggestion chips)
  if (e.target.closest('.prompt-dock')) return;

  // Don't close if the user is clicking an anchor highlight, folded summary, or group toggle
  if (e.target.closest('[data-bucket-id]') || e.target.closest('[data-toggle-group]')) return;

  // Don't close if the user just dragged to select text
  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) return;

  foldActiveBucket();
});

// Keyboard Escape hatch
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeBucketId) {
    foldActiveBucket();
  }
});

// Mobile Bottom Sheet Drag-Down-to-Close Gesture
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

    // Allow dragging from the grab bar/header, or pulling down when bucket thread is scrolled to top
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

    // Only engage drag when pulling downward
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
  // Toggle collapsible "N Clarifications" group under a message
  const groupToggle = e.target.closest('[data-toggle-group]');
  if (groupToggle) {
    const msgId = groupToggle.getAttribute('data-toggle-group');
    state.expandedFoldedGroups[msgId] = !state.expandedFoldedGroups[msgId];
    render();
    return;
  }

  // Close Bucket button or mobile sheet grab handle
  if (e.target.closest('#btn-fold-bucket') || e.target.closest('#sheet-grab-bar')) {
    foldActiveBucket();
    return;
  }

  // Click highlighted anchor or folded summary to open/switch bucket
  const anchorEl = e.target.closest('[data-bucket-id]');
  if (anchorEl && !e.target.closest('.btn-promote-main') && !e.target.closest('#bucket-form')) {
    const bId = anchorEl.getAttribute('data-bucket-id');
    if (state.buckets[bId]) {
      // Toggle closed if clicking the already-active anchor phrase
      if (state.activeBucketId === bId && !state.buckets[bId].folded) {
        foldActiveBucket();
      } else {
        state.buckets[bId].folded = false;
        state.activeBucketId = bId;
        render();
      }
    }
    return;
  }

  // Promote bucket item back to Main Chat ("Move to Main Chat")
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
      state.mainMessages.push(
        { id: 'msg-' + Date.now() + '-u', role: 'user', rawText: removed.question },
        {
          id: 'msg-' + Date.now() + '-a',
          role: 'assistant',
          rawText: removed.answer,
          originBucketMeta: bucketMeta
        }
      );
      if (bucket.items.length === 0) {
        delete state.buckets[bId];
        state.activeBucketId = null;
      }
      render({ scrollMainToBottom: true });
    }
    return;
  }

  // Move a Main Chat Q&A pair back into a Clarification Bucket ("↘ Move to Clarification Bucket")
  const demoteBtn = e.target.closest('.btn-demote-bucket');
  if (demoteBtn) {
    const msgId = demoteBtn.getAttribute('data-msg-id');
    const aIdx = state.mainMessages.findIndex((m) => m.id === msgId);
    if (aIdx > 0 && state.mainMessages[aIdx - 1]?.role === 'user') {
      const userMsg = state.mainMessages[aIdx - 1];
      const assistantMsg = state.mainMessages[aIdx];

      // Find the preceding assistant message to anchor to if needed
      const prevAssistant = [...state.mainMessages.slice(0, aIdx - 1)]
        .reverse()
        .find((m) => m.role === 'assistant');

      // Remove the user + assistant pair from mainMessages
      state.mainMessages.splice(aIdx - 1, 2);

      let targetBucket = null;

      if (assistantMsg.originBucketMeta) {
        const meta = assistantMsg.originBucketMeta;
        if (!state.buckets[meta.id]) {
          state.buckets[meta.id] = {
            ...meta,
            folded: false,
            items: []
          };
        }
        targetBucket = state.buckets[meta.id];
      } else {
        // User manually moved a main-thread Q&A into a bucket
        const parentId = prevAssistant ? prevAssistant.id : state.mainMessages[1]?.id;
        const parentText = (prevAssistant || state.mainMessages[1])?.rawText || '';
        const words = userMsg.rawText
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 3);
        const matchedWord = words.find((w) =>
          parentText.toLowerCase().includes(w.toLowerCase())
        );

        let anchorPhrase = userMsg.rawText;
        if (matchedWord) {
          const regex = new RegExp(`(\\b\\w+\\s+)?\\b\\w*${matchedWord}\\w*\\b(\\s+\\w+\\b)?`, 'i');
          const match = parentText.match(regex);
          if (match) anchorPhrase = match[0].trim();
        }

        const newId = 'bucket-' + (Object.keys(state.buckets).length + 1);
        targetBucket = {
          id: newId,
          parentMessageId: parentId,
          anchorPhrase,
          takeaway: assistantMsg.rawText.split(/(?<=[.!?])\s+/)[0] || assistantMsg.rawText,
          folded: false,
          items: []
        };
        state.buckets[newId] = targetBucket;
      }

      targetBucket.folded = false;
      targetBucket.items.push({
        question: userMsg.rawText,
        answer: assistantMsg.rawText
      });
      state.activeBucketId = targetBucket.id;
      state.lastBucketId = targetBucket.id;
      render();
    }
  }
});

render();
