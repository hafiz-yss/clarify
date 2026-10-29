/**
 * Clarify — Lazy Per-Thread Local Storage & Configuration Manager
 *
 * Architecture:
 *  - Separates the lightweight sidebar index (`clarify_threads_index`) from individual
 *    thread payloads (`clarify_thread_<id>`) so only the active thread is held in memory.
 *  - Preserves a built-in interactive demo thread ("RSA Public-Key Cryptography") so
 *    users can explore Clarify with zero setup or switch to a blank thread anytime.
 */

const INDEX_KEY = 'clarify_threads_index_v1';
const THREAD_PREFIX = 'clarify_thread_v1_';
const AI_CONFIG_KEY = 'clarify_ai_config_v1';

export const DEMO_THREAD_ID = 'demo-rsa-cryptography';

const VALID_THREAD_ID_RE = /^(demo-rsa-cryptography|thread-\d{1,20})$/;

/**
 * Validate that a thread ID conforms to the strict allowlist format before using it in URLs or storage keys
 */
export function isValidThreadId(threadId) {
  return typeof threadId === 'string' && VALID_THREAD_ID_RE.test(threadId);
}

export const DEMO_SUGGESTIONS = [
  "What is Euler's totient function?",
  'Why a modular multiplicative inverse?',
  'How does decryption work?'
];

export const DEMO_INITIAL_MESSAGES = [
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

function safeGetItem(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetItem(key, val) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

function safeRemoveItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

export function createDefaultDemoThread() {
  return {
    id: DEMO_THREAD_ID,
    title: 'RSA Public-Key Cryptography',
    isDemo: true,
    updatedAt: Date.now(),
    mainMessages: structuredClone(DEMO_INITIAL_MESSAGES),
    buckets: {},
    activeBucketId: null,
    lastBucketId: null,
    usedPrompts: []
  };
}

/**
 * Load the lightweight sidebar thread index
 */
export function loadThreadIndex() {
  const raw = safeGetItem(INDEX_KEY);
  let list = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed.filter(
          (item) => item && typeof item === 'object' && isValidThreadId(item.id)
        );
      }
    } catch {
      list = [];
    }
  }

  // Ensure the built-in interactive demo thread is always available in the index
  if (!list.some((item) => item.id === DEMO_THREAD_ID)) {
    const demo = createDefaultDemoThread();
    safeSetItem(THREAD_PREFIX + DEMO_THREAD_ID, JSON.stringify(demo));
    list.push({
      id: DEMO_THREAD_ID,
      title: demo.title,
      isDemo: true,
      updatedAt: demo.updatedAt
    });
    safeSetItem(INDEX_KEY, JSON.stringify(list));
  }

  return list;
}

export function saveThreadIndex(indexList) {
  safeSetItem(INDEX_KEY, JSON.stringify(indexList));
}

/**
 * Load a single thread's full message + bucket payload into memory on demand
 */
export function loadThreadData(threadId) {
  if (!isValidThreadId(threadId)) return null;
  const raw = safeGetItem(THREAD_PREFIX + threadId);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.id === threadId) {
        return parsed;
      }
    } catch {
      // Fallback below
    }
  }
  if (threadId === DEMO_THREAD_ID) {
    const demo = createDefaultDemoThread();
    saveThreadData(demo);
    return demo;
  }
  return null;
}

/**
 * Save a single thread's payload and update its entry in the lightweight sidebar index
 */
export function saveThreadData(thread) {
  if (!thread || !isValidThreadId(thread.id)) return;
  const payload = {
    id: thread.id,
    title: String(thread.title || 'Untitled Thread').slice(0, 120),
    isDemo: Boolean(thread.isDemo),
    updatedAt: Date.now(),
    mainMessages: Array.isArray(thread.mainMessages) ? thread.mainMessages : [],
    buckets: thread.buckets && typeof thread.buckets === 'object' ? thread.buckets : {},
    activeBucketId: typeof thread.activeBucketId === 'string' ? thread.activeBucketId : null,
    lastBucketId: typeof thread.lastBucketId === 'string' ? thread.lastBucketId : null,
    usedPrompts: Array.isArray(thread.usedPrompts) ? thread.usedPrompts : []
  };

  safeSetItem(THREAD_PREFIX + payload.id, JSON.stringify(payload));

  const index = loadThreadIndex();
  const existingIdx = index.findIndex((i) => i.id === payload.id);
  const meta = {
    id: payload.id,
    title: payload.title,
    isDemo: payload.isDemo,
    updatedAt: payload.updatedAt
  };

  if (existingIdx >= 0) {
    index[existingIdx] = meta;
  } else {
    index.unshift(meta);
  }
  saveThreadIndex(index);
}

/**
 * Reset the interactive Demo Thread back to its clean initial state
 */
export function resetDemoThread() {
  const fresh = createDefaultDemoThread();
  saveThreadData(fresh);
  return fresh;
}

/**
 * Delete a user thread (or reset the demo thread if clicked on demo)
 */
export function deleteThreadData(threadId) {
  if (!isValidThreadId(threadId)) return;
  if (threadId === DEMO_THREAD_ID) {
    resetDemoThread();
    return;
  }
  safeRemoveItem(THREAD_PREFIX + threadId);
  const index = loadThreadIndex().filter((i) => i.id !== threadId);
  saveThreadIndex(index);
}

/**
 * Load & save client-side AI configuration (API key stays strictly in localStorage)
 */
export function loadAIConfig() {
  const raw = safeGetItem(AI_CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        apiKey: (parsed.apiKey || '').trim(),
        model: parsed.model || 'gemini-2.5-flash'
      };
    } catch {
      // Fallback
    }
  }
  return {
    apiKey: '',
    model: 'gemini-2.5-flash'
  };
}

export function saveAIConfig(config) {
  const clean = {
    apiKey: (config.apiKey || '').trim(),
    model: config.model || 'gemini-2.5-flash'
  };
  safeSetItem(AI_CONFIG_KEY, JSON.stringify(clean));
  return clean;
}
