# Clarify — Context-Anchored AI Learning Interface

**Clarify** solves the "Linear Chat Rabbit-Hole Problem" when learning with AI. Instead of letting follow-up clarifications and sub-questions pollute the main learning timeline, Clarify automatically detects when a prompt is a clarification, highlights the exact anchor phrase in the parent explanation, and routes the sub-thread into a **tethered Side-Panel Bucket**.

## Core UX & Psychological Design Principles
1. **Zero Friction / Auto-Routing:** Users type naturally in the main bottom prompt bar. The Semantic Context Router ([`src/router.js`](file:///C:/Users/CLS/Documents/webdev/Clarify/src/router.js)) classifies whether the question is:
   - `PROGRESSION`: Moving forward on the main learning spine (auto-folds any open bucket).
   - `CLARIFICATION`: Asking about a specific phrase/concept in an explanation above (auto-highlights the phrase and opens a tethered side-panel bucket).
   - `BUCKET_DRILLDOWN`: Asking a follow-up ("clarification of a clarification") while a bucket is open.
2. **Automatic Phrase Anchoring:** When a clarification is detected, the exact concept phrase in the parent explanation is highlighted (`<mark class="concept-anchor">`) and linked to its Side-Panel Bucket with a count badge (`🗂️ N`).
3. **Nested Drill-Downs & Distillation:** Sub-questions stay grouped inside the active bucket with a concise **Distilled Takeaway** summary at the top.
4. **Effortless User Escape Hatches:**
   - **`✓ Done (Fold to Summary)`**: Collapses the bucket into an inline summary strip under the parent message and returns focus to the main chat.
   - **`↖ Move out of bucket to Main Chat`**: One-click promotion if the user wants a bucketed Q&A moved back into the main linear chat stream.

## Project Structure
```text
Clarify/
├── index.html        # Main workspace UI (Main Learning Spine + Tethered Bucket Panel + Prompt Dock)
├── package.json      # Project metadata & scripts
├── server.js         # Local static development server (Port 3001)
└── src/
    ├── app.js        # UI state machine, bucket lifecycle, and DOM anchor highlighter
    ├── router.js     # Semantic Intent Classifier & Anchor Phrase Extractor
    └── styles.css    # Split-workspace layout & tethered side-panel styling
```

## Development & Engineering Notes
- **Dual-Mode Architecture Goal:** Support both an instant zero-setup interactive sandbox mode (for portfolio reviewers) and an optional client-side BYOK Live AI mode (e.g., free-tier Gemini API stored strictly in browser `localStorage`) so hosting on Vercel stays 100% free (`0` server compute).
- **Git & Portfolio Standards:** Maintain a clean, natural, incremental commit history authored under the local global git config (`Yakub Hafiz`), with production static hosting headers (`vercel.json` / `.vercelignore`) when ready to deploy.
