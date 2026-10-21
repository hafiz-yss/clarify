/**
 * Clarify — Semantic Intent Classifier & Anchor Extractor
 *
 * Automatically determines whether a user's prompt in the main input bar is:
 *  - 'CLARIFICATION': Asking about a term/concept from the main explanation above
 *  - 'BUCKET_DRILLDOWN': Asking a follow-up to the currently open Clarification Bucket
 *  - 'PROGRESSION': Moving forward with the main learning thread
 */

const STOP_WORDS = new Set([
  'what', 'is', 'are', 'the', 'a', 'an', 'in', 'on', 'of', 'to', 'for', 'and', 'or',
  'why', 'how', 'does', 'do', 'did', 'you', 'we', 'mean', 'by', 'can', 'explain',
  'wait', 'about', 'that', 'this', 'it', 'with', 'simple', 'terms', 'example', 'Wait'
]);

const CLARIFICATION_PATTERNS = /^(wait\b|what\b|why\b|how\s+does|how\s+do|how\s+is|what's|whats|mean\b|explain\b|clarify\b|confused|don't\s+understand|can\s+you\s+give|give\s+an?\s+example|example\s+of|for\s+example)/i;

/**
 * Find the best matching phrase in a message's concepts or sentences
 */
export function classifyPromptIntent(promptText, mainMessages, buckets, activeBucketId, lastBucketId) {
  const clean = promptText.trim();
  const lower = clean.toLowerCase();

  // Extract meaningful keywords from the user's question
  const tokens = lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // 1. Check if the user's question matches a specific anchor concept in any assistant message
  const assistantMsgs = [...mainMessages].reverse().filter((m) => m.role === 'assistant');

  for (const msg of assistantMsgs) {
    if (Array.isArray(msg.concepts)) {
      for (const concept of msg.concepts) {
        const matchScore = concept.keywords.reduce(
          (acc, kw) => (lower.includes(kw.toLowerCase()) ? acc + 2 : acc),
          0
        );
        if (matchScore > 0) {
          return {
            intent: 'CLARIFICATION',
            targetMessageId: msg.id,
            anchorPhrase: concept.phrase,
            conceptKey: concept.key,
            cannedAnswer: concept.explanation,
            takeaway: concept.takeaway
          };
        }
      }
    }
  }

  // 2. If a bucket is open OR was recently used, and the user asks a follow-up ("why?", "can you give an example?", etc.)
  //    automatically route to and open that bucket!
  const candidateBucketId = activeBucketId || lastBucketId || Object.keys(buckets).pop();
  if (candidateBucketId && buckets[candidateBucketId]) {
    const targetBucket = buckets[candidateBucketId];
    const isProgressionAttempt = /^(next\b|now\s+let's|move\s+on|okay\s*,?\s*now|show\s+me\s+how\s+decryption|tell\s+me\s+about\s+a\s+new)/i.test(clean);
    if (!isProgressionAttempt && (CLARIFICATION_PATTERNS.test(clean) || tokens.length <= 6)) {
      return {
        intent: 'BUCKET_DRILLDOWN',
        bucketId: candidateBucketId,
        targetMessageId: targetBucket.parentMessageId,
        anchorPhrase: targetBucket.anchorPhrase,
        cannedAnswer:
          targetBucket.drilldownAnswer ||
          `Great follow-up on "${targetBucket.anchorPhrase}". Think of it with small concrete numbers first: each step stays self-contained here in this bucket so your main lesson on the left stays completely uncluttered.`
      };
    }
  }

  // 3. Fallback: If it looks like a clarification question, anchor to the best matching phrase in the latest assistant message
  if (CLARIFICATION_PATTERNS.test(clean) && assistantMsgs.length > 0 && tokens.length > 0) {
    const latestMsg = assistantMsgs[0];
    const plainText = latestMsg.rawText || '';
    const sentences = plainText.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      const hit = tokens.find((t) => sentence.toLowerCase().includes(t));
      if (hit) {
        // Extract a 2-4 word window around the matched keyword
        const regex = new RegExp(`(\\b\\w+\\s+)?\\b\\w*${hit}\\w*\\b(\\s+\\w+\\b)?`, 'i');
        const match = sentence.match(regex);
        const phrase = match ? match[0].trim() : hit;
        return {
          intent: 'CLARIFICATION',
          targetMessageId: latestMsg.id,
          anchorPhrase: phrase,
          cannedAnswer: `Here is a focused clarification on "${phrase}": it refers specifically to how this step operates within the broader concept, isolated here so we don't derail your main learning thread.`,
          takeaway: `${phrase}: clarified in context.`
        };
      }
    }
  }

  return {
    intent: 'PROGRESSION',
    targetMessageId: null,
    anchorPhrase: null
  };
}
