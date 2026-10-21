import { classifyPromptIntent } from './router.js';

export const state = {
  activeBucketId: null,
  lastBucketId: null,
  buckets: {},
  mainMessages: [
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
  ]
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function foldActiveBucket() {
  if (state.activeBucketId && state.buckets[state.activeBucketId]) {
    state.lastBucketId = state.activeBucketId;
    state.buckets[state.activeBucketId].folded = true;
    state.activeBucketId = null;
    render();
  }
}

function render(options = {}) {
  chatStream.innerHTML = state.mainMessages
    .map((msg, idx) => {
      if (msg.role === 'user') {
        return `<div class="msg-card msg-user">${escapeHtml(msg.rawText)}</div>`;
      }

      const foldedBuckets = Object.values(state.buckets).filter(
        (b) => b.parentMessageId === msg.id && b.folded && b.items.length > 0
      );

      const foldedHtml =
        foldedBuckets.length > 0
          ? `<div class="folded-buckets-bar">
              ${foldedBuckets
                .map(
                  (b) => `
                <div class="folded-summary-item" data-bucket-id="${b.id}">
                  <span><strong>${escapeHtml(b.anchorPhrase)}</strong> — ${escapeHtml(b.takeaway)}</span>
                  <span class="folded-open-label">View (${b.items.length}) →</span>
                </div>`
                )
                .join('')}
            </div>`
          : '';

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

  const activeBucket = state.activeBucketId ? state.buckets[state.activeBucketId] : null;
  if (activeBucket && !activeBucket.folded && activeBucket.items.length > 0) {
    workspaceGrid.classList.add('has-open-bucket');
    bucketPanel.setAttribute('aria-hidden', 'false');

    bucketPanelInner.innerHTML = `
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
  } else {
    workspaceGrid.classList.remove('has-open-bucket');
    bucketPanel.setAttribute('aria-hidden', 'true');
  }

  if (options.scrollMainToBottom && mainScroll) {
    requestAnimationFrame(() => {
      mainScroll.scrollTo({
        top: mainScroll.scrollHeight,
        behavior: 'smooth'
      });
    });
  }
}

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
    bucket.items.push({ question: clean, answer: decision.cannedAnswer });
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
    bucket.items.push({ question: clean, answer: decision.cannedAnswer });
    render();
    return;
  }

  if (state.activeBucketId && state.buckets[state.activeBucketId]) {
    state.lastBucketId = state.activeBucketId;
    state.buckets[state.activeBucketId].folded = true;
    state.activeBucketId = null;
  }

  state.mainMessages.push(
    { id: 'msg-' + (state.mainMessages.length + 1), role: 'user', rawText: clean },
    {
      id: 'msg-' + (state.mainMessages.length + 2),
      role: 'assistant',
      rawText:
        'Now that your key pair is ready, RSA encryption and decryption are straightforward: To encrypt a message M, the sender computes ciphertext C = M^e mod n. To decrypt C back into M, the receiver uses their private key d to compute M = C^d mod n.'
    }
  );

  render({ scrollMainToBottom: true });
}

promptForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = promptInput.value;
  promptInput.value = '';
  handlePromptSubmit(val);
});

suggestionChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.try-chip');
  if (!btn) return;
  handlePromptSubmit(btn.dataset.prompt);
});

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

mainSpine.addEventListener('click', (e) => {
  if (!state.activeBucketId) return;
  if (e.target.closest('.prompt-dock')) return;
  if (e.target.closest('[data-bucket-id]')) return;
  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) return;
  foldActiveBucket();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeBucketId) {
    foldActiveBucket();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-fold-bucket')) {
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
  }
});

render();
