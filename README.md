# Clarify — Context-Anchored AI Learning Interface

**Clarify** solves the "Linear Chat Rabbit-Hole Problem" when learning with AI. Instead of letting follow-up clarifications and tangents clutter the main learning timeline, Clarify detects when a question is a clarification, highlights the exact anchor phrase in the parent explanation, and isolates the sub-thread into a **tethered Side-Panel Bucket**.

## Core Architecture & UX Principles

1. **Semantic Pedagogical Routing (`src/ai.js` & `src/router.js`):**
   - Evaluates the derived pedagogical intent of each prompt:
     - `PROGRESSION`: Advances the main learning spine forward (and automatically folds any open bucket into a compact summary pill).
     - `CLARIFICATION`: Unpacks a concept, step, or assumption from an earlier explanation—highlighting the verbatim anchor phrase (`<mark class="concept-anchor">`) and opening a tethered Side-Panel Bucket.
     - `BUCKET_DRILLDOWN`: Routes deeper follow-ups directly into the active or most recent Clarification Bucket.
   - **Context-Window Pruning:** Main-spine queries send only the most recent 6 main messages (excluding side-bucket chatter), while bucket follow-ups send only the single parent message plus that bucket's Q&A history.

2. **Spatial Split-Pane & Mobile Sheet (`src/styles.css`):**
   - **Desktop:** Full-height 50/50 split workbench that keeps the main explanation and active clarification side-by-side.
   - **Mobile (`<= 860px`):** iOS-style `78dvh` bottom sheet with drag-to-dismiss and a `22dvh` top peek window that scrolls the highlighted anchor phrase into view.

3. **Lazy Per-Thread Persistence (`src/storage.js`):**
   - Separates the lightweight sidebar thread index (`clarify_threads_index_v1`) from individual thread payloads (`clarify_thread_v1_<id>`) so only the active thread is loaded into memory.
   - Includes a self-contained **RSA Public-Key Cryptography (Demo)** thread that runs deterministically offline alongside live BYOK threads (Google Gemini, OpenAI, and Groq).

## Project Structure

```text
Clarify/
├── index.html        # Split-pane workspace, collapsible thread sidebar, and API connection modal
├── package.json      # Project metadata & scripts
├── server.js         # Zero-dependency static development server (Port 3001)
└── src/
    ├── ai.js         # Provider-agnostic live AI router with context pruning & key verification
    ├── app.js        # UI state machine, rich text/math formatter, and sheet gesture controller
    ├── router.js     # Deterministic local intent classifier for the interactive demo thread
    ├── storage.js    # Lazy per-thread localStorage index & payload manager
    └── styles.css    # Monochrome editorial design system & responsive bottom-sheet layout
```

## Running Locally

```bash
npm start
# Open http://localhost:3001
```
