import { classifyPromptIntent } from './router.js';

export const state = {
  activeBucketId: null,
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
const chatStream = document.getElementById('chat-stream');
const bucketPanel = document.getElementById('bucket-panel');
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

function render() {
  chatStream.innerHTML = state.mainMessages
    .map((msg) => {
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
                  <span><strong>${escapeHtml(b.anchorPhrase)}:</strong> ${escapeHtml(b.takeaway)}</span>
                  <span>View (${b.items.length}) →</span>
                </div>`
                )
                .join('')}
            </div>`
          : '';

      return `
        <article class="msg-card msg-assistant" data-msg-id="${msg.id}">
          <div class="msg-body">
            ${formatAssistantTextWithAnchors(msg)}
          </div>
          ${foldedHtml}
        </article>
      `;
    })
    .join('');

  const activeBucket = state.activeBucketId ? state.buckets[state.activeBucketId] : null;
  if (activeBucket && !activeBucket.folded && activeBucket.items.length > 0) {
    workspaceGrid.classList.add('has-open-bucket');
    bucketPanel.classList.remove('hidden');

    bucketPanel.innerHTML = `
      <div class="bucket-header">
        <div class="bucket-title">${escapeHtml(activeBucket.anchorPhrase)}</div>
        <button type="button" class="btn-bucket-done" id="btn-fold-bucket">Done</button>
      </div>
      <div class="bucket-thread">
        ${activeBucket.items
          .map(
            (item, idx) => `
          <div class="bucket-qa-card">
            <div class="bucket-q">${escapeHtml(item.question)}</div>
            <div class="bucket-a">${escapeHtml(item.answer)}</div>
            <button type="button" class="btn-promote-main" data-bucket-id="${activeBucket.id}" data-item-idx="${idx}">
              ↖ Move to Main Chat
            </button>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else {
    workspaceGrid.classList.remove('has-open-bucket');
    bucketPanel.classList.add('hidden');
    bucketPanel.innerHTML = '';
  }
}

function handlePromptSubmit(text) {
  const clean = text.trim();
  if (!clean) return;

  const decision = classifyPromptIntent(
    clean,
    state.mainMessages,
    state.buckets,
    state.activeBucketId
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
        items: []
      };
      state.buckets[id] = bucket;
    }

    bucket.folded = false;
    bucket.items.push({ question: clean, answer: decision.cannedAnswer });
    state.activeBucketId = bucket.id;
  } else if (decision.intent === 'BUCKET_DRILLDOWN') {
    const bucket = state.buckets[decision.bucketId];
    bucket.items.push({ question: clean, answer: decision.cannedAnswer });
  } else {
    if (state.activeBucketId && state.buckets[state.activeBucketId]) {
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
  }

  render();
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

document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-fold-bucket')) {
    if (state.activeBucketId && state.buckets[state.activeBucketId]) {
      state.buckets[state.activeBucketId].folded = true;
      state.activeBucketId = null;
      render();
    }
    return;
  }

  const anchorEl = e.target.closest('[data-bucket-id]');
  if (anchorEl && !e.target.closest('.btn-promote-main')) {
    const bId = anchorEl.getAttribute('data-bucket-id');
    if (state.buckets[bId]) {
      state.buckets[bId].folded = false;
      state.activeBucketId = bId;
      render();
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
      state.mainMessages.push(
        { id: 'msg-' + (state.mainMessages.length + 1), role: 'user', rawText: removed.question },
        { id: 'msg-' + (state.mainMessages.length + 2), role: 'assistant', rawText: removed.answer }
      );
      if (bucket.items.length === 0) {
        delete state.buckets[bId];
        state.activeBucketId = null;
      }
      render();
    }
  }
});

render();
