/**
 * Clarify — Semantic Pedagogical AI Engine & Context-Pruned Client
 *
 * Core Principles:
 *  1. Pedagogical Intent over Keyword Matching:
 *     Evaluates the derived learning trajectory of the user's question:
 *     - 'CLARIFICATION': The user is trying to unblock their understanding of a concept,
 *       step, assumption, or claim *already introduced* in an earlier assistant message,
 *       even if they use completely different words ("wait, why subtract 1 from both numbers?").
 *     - 'PROGRESSION': The user is advancing the lesson forward to a new stage, applying
 *       concepts to a next step, or starting a new topic, even if they mention earlier terms.
 *     - 'BUCKET_DRILLDOWN': The user is asking a direct follow-up to the active/recent bucket.
 *
 *  2. Context-Window Pruning:
 *     - Main bar queries only send the last 6 main-spine messages (folded bucket chatter is excluded).
 *     - Bucket follow-up queries only send the 1 parent message + that specific bucket's Q&As.
 *
 *  3. Provider Auto-Detection:
 *     Supports Google Gemini (`AIza...`), Groq (`gsk_...`), and OpenAI (`sk-...`) keys automatically.
 */

const MAX_MAIN_CONTEXT_MESSAGES = 6;
const API_REQUEST_TIMEOUT_MS = 30000;

function redactSensitiveError(message, apiKey) {
  let text = String(message || 'API request failed.');
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey.length >= 6 && text.includes(cleanKey)) {
    text = text.split(cleanKey).join('[REDACTED]');
  }
  return text;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      referrerPolicy: 'no-referrer',
       credentials: 'omit',
      signal: controller.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds. Please check your connection.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function detectProvider(apiKey) {
  const clean = String(apiKey || '').trim();
  if (clean.startsWith('gsk_')) return 'groq';
  if (clean.startsWith('sk-')) return 'openai';
  return 'gemini';
}

/**
 * Align an AI-returned anchor phrase to the exact verbatim substring inside `parentText`
 * so the yellow highlight always matches cleanly in the DOM.
 */
export function resolveVerbatimAnchor(parentText, candidatePhrase, fallbackPrompt = '') {
  const source = String(parentText || '');
  if (!source) return candidatePhrase || 'concept';

  const cleanCandidate = String(candidatePhrase || '')
    .trim()
    .replace(/^["'*`]+|["'*`]+$/g, '')
    .replace(/\*\*|`/g, '');

  if (cleanCandidate.length >= 2) {
    const idx = source.toLowerCase().indexOf(cleanCandidate.toLowerCase());
    if (idx !== -1) {
      return source.slice(idx, idx + cleanCandidate.length).replace(/\*\*|`/g, '');
    }
  }

  const words = (cleanCandidate || fallbackPrompt)
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  for (const word of words) {
    const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(\\b\\w+\\s+)?\\b\\w*${safeWord}\\w*\\b(\\s+\\w+\\b)?`, 'i');
    const match = source.match(regex);
    if (match && match[0]) {
      return match[0].trim();
    }
  }

  const firstClause = source.split(/[.,;:!?]/)[0] || source;
  return firstClause.trim().split(/\s+/).slice(0, 4).join(' ');
}

/**
 * Derive a clean 3-5 word thread title from the user's first prompt if not provided by AI
 */
export function deriveFallbackTitle(promptText) {
  const cleaned = String(promptText || '')
    .replace(
      /^(explain|what\s+is|how\s+does|how\s+do|tell\s+me\s+about|teach\s+me\s+about|why\s+does|can\s+you\s+explain)\s+/i,
      ''
    )
    .replace(/[?.!]+$/g, '')
    .trim();

  if (!cleaned) return 'New Learning Thread';
  const words = cleaned.split(/\s+/).slice(0, 5).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Verify an API Key before saving
 */
export async function verifyApiKey(apiKey) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey || cleanKey.length > 256 || /\s/.test(cleanKey)) {
    throw new Error('Please enter a valid API key.');
  }

  const provider = detectProvider(cleanKey);

  if (provider === 'openai' || provider === 'groq') {
    const baseUrl =
      provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    const res = await fetchWithTimeout(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanKey}` }
    });
    if (!res.ok) {
      let errDetail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error?.message) errDetail = errJson.error.message;
      } catch {
        // Ignore
      }
      throw new Error(redactSensitiveError(errDetail, cleanKey));
    }
    return true;
  }

  // Default: Google Gemini API (pass key via x-goog-api-key header rather than URL query string)
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models';
  const res = await fetchWithTimeout(endpoint, {
    method: 'GET',
    headers: { 'x-goog-api-key': cleanKey }
  });
  if (!res.ok) {
    let errDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) errDetail = errJson.error.message;
    } catch {
      // Ignore
    }
    throw new Error(redactSensitiveError(errDetail, cleanKey));
  }
  return true;
}

/**
 * Analyze intent & respond using the connected AI provider with a pruned context window
 */
export async function analyzeAndRespondWithAI({
  apiKey,
  promptText,
  mainMessages,
  buckets,
  activeBucketId,
  lastBucketId,
  forcedMode = null
}) {
  // Case A: Dedicated follow-up inside an open Clarification Bucket (Pruned to 1 parent msg + bucket thread)
  if (forcedMode === 'BUCKET_FOLLOWUP' && activeBucketId && buckets[activeBucketId]) {
    const bucket = buckets[activeBucketId];
    const parentMsg = mainMessages.find((m) => m.id === bucket.parentMessageId);
    const bucketHistory = bucket.items
      .slice(-4)
      .map((item, i) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`)
      .join('\n\n');

    const systemInstruction = `You are Clarify, a focused AI learning tutor. The user is inside a side-panel Clarification Bucket anchored to the phrase "${bucket.anchorPhrase}" from the parent lesson.
Answer their follow-up question clearly and concisely (2-4 sentences) so they can resolve their confusion and return to the main lesson. Also provide an updated 1-sentence distilled takeaway summary for this bucket if helpful.
Respond strictly in JSON matching this schema:
{
  "answer": "Clear, direct explanation answering the follow-up question",
  "takeaway": "Concise 1-sentence takeaway summary (max 16 words)"
}`;

    const userContent = `PARENT LESSON EXCERPT:
${parentMsg ? parentMsg.rawText : ''}

ANCHORED CONCEPT: "${bucket.anchorPhrase}"
CURRENT BUCKET TAKEAWAY: "${bucket.takeaway}"

PREVIOUS BUCKET Q&A:
${bucketHistory || '(none)'}

NEW FOLLOW-UP QUESTION IN BUCKET:
${promptText}`;

    const data = await callProviderJson(apiKey, systemInstruction, userContent);
    return {
      intent: 'BUCKET_DRILLDOWN',
      bucketId: bucket.id,
      targetMessageId: bucket.parentMessageId,
      anchorPhrase: bucket.anchorPhrase,
      answer: data.answer || 'Here is a closer look at how this concept operates in context.',
      takeaway: data.takeaway || bucket.takeaway
    };
  }

  // Case B: First-turn message in a brand-new empty thread -> Always PROGRESSION
  const assistantMessages = mainMessages.filter((m) => m.role === 'assistant');
  if (assistantMessages.length === 0) {
    const systemInstruction = `You are Clarify, an AI learning tutor designed for clear, structured conceptual explanations.
The user is starting a new learning thread. Explain the topic clearly in 1-2 well-structured paragraphs with concrete intuition.
Respond strictly in JSON matching this schema:
{
  "threadTitle": "Concise 3-5 word topic title",
  "answer": "Clear explanation of the user's topic"
}`;

    const data = await callProviderJson(apiKey, systemInstruction, promptText);
    return {
      intent: 'PROGRESSION',
      threadTitle: data.threadTitle || deriveFallbackTitle(promptText),
      answer: data.answer || ''
    };
  }

  // Case C: Main Prompt Bar Query (Pruned to last 6 Main Spine messages + active/recent bucket metadata)
  const recentMain = mainMessages.slice(-MAX_MAIN_CONTEXT_MESSAGES);
  const formattedMain = recentMain
    .map((m) => `[${m.id}] (${m.role.toUpperCase()}): ${m.rawText}`)
    .join('\n\n');

  const candidateBucketId = activeBucketId || lastBucketId;
  const recentBucket = candidateBucketId ? buckets[candidateBucketId] : null;
  const recentBucketContext = recentBucket
    ? `RECENT CLARIFICATION BUCKET (id="${recentBucket.id}", parentMessageId="${recentBucket.parentMessageId}", anchorPhrase="${recentBucket.anchorPhrase}"):\nLast Q&A: ${
        recentBucket.items[recentBucket.items.length - 1]?.question || ''
      } -> ${recentBucket.items[recentBucket.items.length - 1]?.answer || ''}`
    : 'RECENT CLARIFICATION BUCKET: None';

  const systemInstruction = `You are the Semantic Pedagogical Router and Tutor for Clarify, a context-anchored AI learning workspace.

Your job is to evaluate the user's new prompt based on DERIVED PEDAGOGICAL CONTEXT (not naive keyword matching):
1. Classify "intent" into one of three values:
   - "CLARIFICATION": The user is asking to clarify, unpack, define, justify, or see an example of a concept, step, or claim ALREADY introduced in one of the assistant messages above — EVEN IF the user uses completely different words or pronouns (e.g., "wait why subtract 1 from both?", "what does that second part mean?").
   - "BUCKET_DRILLDOWN": A RECENT CLARIFICATION BUCKET exists AND the user's prompt is a direct follow-up drilling deeper into that specific bucket's explanation (e.g., "can you give a tiny number example of that?").
   - "PROGRESSION": The user understands the current explanation and is moving the main lesson FORWARD to the next logical step, applying it to a new problem, or shifting to a new sub-topic — EVEN IF they mention keywords from earlier messages (e.g., "Now that we have the private key d, how does decryption work?").

2. If intent is "CLARIFICATION":
   - Set "targetMessageId" to the exact ID (e.g. "msg-2") of the assistant message being clarified.
   - Set "anchorPhrase" to an EXACT verbatim 2-to-5 word phrase copied directly from that assistant message that best represents the concept the user is asking about.
   - Set "takeaway" to a crisp 1-sentence summary (max 15 words) of the clarification.
   - Set "answer" to a clear, focused explanation (2-4 sentences) that resolves the confusion.

3. If intent is "BUCKET_DRILLDOWN":
   - Set "targetMessageId" to the recent bucket's parentMessageId and "anchorPhrase" to the recent bucket's anchorPhrase.
   - Set "answer" to a clear follow-up explanation or concrete example.

4. If intent is "PROGRESSION":
   - Set "targetMessageId" to null and "anchorPhrase" to null.
   - Set "answer" to the next main-thread explanation (1-2 clear, well-structured paragraphs).

Respond strictly in valid JSON matching this schema:
{
  "intent": "CLARIFICATION" | "BUCKET_DRILLDOWN" | "PROGRESSION",
  "targetMessageId": "msg-id or null",
  "anchorPhrase": "exact verbatim 2-5 word substring from targetMessageId, or null",
  "takeaway": "1-sentence summary if clarification, or null",
  "answer": "Your response to the user"
}`;

  const userContent = `MAIN LESSON THREAD (most recent ${recentMain.length} messages):
${formattedMain}

${recentBucketContext}

NEW USER PROMPT:
${promptText}`;

  const data = await callProviderJson(apiKey, systemInstruction, userContent);
  const intent = ['CLARIFICATION', 'BUCKET_DRILLDOWN', 'PROGRESSION'].includes(data.intent)
    ? data.intent
    : 'PROGRESSION';

  if (intent === 'BUCKET_DRILLDOWN' && recentBucket) {
    return {
      intent: 'BUCKET_DRILLDOWN',
      bucketId: recentBucket.id,
      targetMessageId: recentBucket.parentMessageId,
      anchorPhrase: recentBucket.anchorPhrase,
      answer: data.answer || '',
      takeaway: data.takeaway || recentBucket.takeaway
    };
  }

  if (intent === 'CLARIFICATION') {
    const targetMsg =
      assistantMessages.find((m) => m.id === data.targetMessageId) ||
      assistantMessages[assistantMessages.length - 1];

    const verbatimAnchor = resolveVerbatimAnchor(
      targetMsg.rawText,
      data.anchorPhrase,
      promptText
    );

    return {
      intent: 'CLARIFICATION',
      targetMessageId: targetMsg.id,
      anchorPhrase: verbatimAnchor,
      takeaway: data.takeaway || `${verbatimAnchor}: clarified in context.`,
      answer: data.answer || ''
    };
  }

  return {
    intent: 'PROGRESSION',
    targetMessageId: null,
    anchorPhrase: null,
    answer: data.answer || ''
  };
}

async function callProviderJson(apiKey, systemInstruction, userText) {
  const cleanKey = String(apiKey || '').trim();
  const provider = detectProvider(cleanKey);

  if (provider === 'openai' || provider === 'groq') {
    const baseUrl =
      provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userText }
        ]
      })
    });

    if (!response.ok) {
      let errDetail = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) errDetail = errJson.error.message;
      } catch {
        // Ignore
      }
      throw new Error(redactSensitiveError(errDetail, cleanKey));
    }

    const payload = await response.json();
    const rawText = payload?.choices?.[0]?.message?.content || '{}';
    return parseJsonResponse(rawText);
  }

  // Google Gemini API (with automatic model fallback if a specific flash version isn't enabled)
  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of modelsToTry) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json'
        }
      })
    });

    if (response.ok) {
      const payload = await response.json();
      const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      return parseJsonResponse(rawText);
    }

    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) errDetail = errJson.error.message;
    } catch {
      // Ignore
    }
    lastError = new Error(redactSensitiveError(errDetail, cleanKey));

    // Only try the next model if it was a 404 model-not-found error
    if (response.status !== 404) {
      throw lastError;
    }
  }

  throw lastError || new Error('API request failed.');
}

function parseJsonResponse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const stripped = String(rawText)
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    return JSON.parse(stripped);
  }
}
