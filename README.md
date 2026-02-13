# Proofline

Proofline is an in-client replay engine for AI coding sessions.
It answers questions like:

- What did I do yesterday?
- Which projects did I touch today?
- Was I polishing a feature or looping on a blocker?

It runs inside your current client context and returns an activity-first narrative with traceable evidence.

## Why It Exists

Most assistants remember the current context window, not your real multi-day work trail.
Proofline reconstructs local session traces into a factual playback:

1. What you did (sequence of actions)
2. Why it mattered (major events + follow-up actions)
3. What changed (file-level deltas as secondary proof)

## Product Rules (Non-Negotiable)

1. Single client per run
2. No cross-client aggregation
3. No fallback full-disk scan
4. Strict path whitelist + access audit
5. Activity-first output, file list second

## SOP

- Index: `SOP.md`
- Product: `SOP_Product.md`
- Engineering: `SOP_Engineering.md`

## Client Coverage

Detection and parsing:

- VS Code
- Cursor
- Claude
- Codex
- OpenCode
- Antigravity

LLM generation runners:

- Supported in v1.1: Codex, Claude, Cursor, OpenCode
- Unsupported in v1.1: VS Code, Antigravity

## Install

```bash
npm install
npm run build
```

Run from build output:

```bash
node dist/apps/cli/src/index.js "what did I do yesterday?"
```

Global command (if linked):

```bash
proofline "what did I do yesterday?"
```

Legacy alias (kept for compatibility):

```bash
wdyd "what did I do yesterday?"
```

## CLI Usage

```bash
proofline "what did I do yesterday?" --client codex --project paper
proofline "what did I do in the last 3 days?" --client codex --all-projects
proofline detect
proofline doctor --client codex
proofline export --client codex --out ./report.html
proofline export --client codex --out ./report.json --format json
```

## Output Contract (Activity-First)

The generated output follows this order:

1. `direct_answer`
2. `what_you_did_first`
3. `instruction_flow`
4. `repetition_diagnosis`
5. `project_breakdown`
6. `file_changes_secondary`
7. `raw_note_deltas`
8. `confidence_notes`
9. `unknowns`

## Architecture

- `apps/cli`: natural-language entry and run orchestration
- `packages/core`: detection, path isolation, query parsing, evidence, insights
- `packages/connectors`: per-client extractors
- `packages/event-engine`: soccer-style event mapping + action chains
- `packages/renderer-tui`: in-terminal three-state UI
- `packages/storage`: local SQLite persistence + export
- `packages/client-runners`: client CLI generation bridge
- `packages/prompt-pack`: prompt contract + token-budget compression

## Development

```bash
npm run lint
npm test
npm run build
```

## GitHub Release Checklist

1. `npm run lint && npm test && npm run build`
2. Verify SOP docs and runtime behavior are aligned
3. Verify activity-first ordering in CLI/TUI/export
4. Commit with a clear release message
5. Tag and push

## License

MIT
