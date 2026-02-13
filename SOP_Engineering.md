# Proofline Engineering SOP

## 1. Core Principles

1. Run in-client, isolate to a single client per run, and never aggregate across clients.
2. Enforce strict path whitelisting with auditable access logs.
3. Prioritize action evidence and keep conflict resolution traceable.
4. Keep output activity-first; file changes are secondary evidence.

## 2. End-to-End Pipeline

1. `detectClient()`
2. `resolvePaths(client)`
3. `discoverProjects(client, paths, events, audit)`
4. `parseQuery(question, now, tz)`
5. Choose project scope (`single` or `ALL`)
6. `scan -> normalize`
7. `collectEvidence()`
8. `resolveConflicts()`
9. `classifyEvents() + buildActionChains()`
10. `analyzeInsights()` (`instructions/repetition/narrative/deltas`)
11. `buildStandardPrompt()`
12. `runClientLLM()` (optional)
13. `saveRun()` + `export`

## 3. Path Isolation and Audit

1. Read only the active client's whitelist paths.
2. Never fall back to full-disk scanning when detection fails.
3. Record all `read/glob/sqlite/scan/runner` actions in `PathAccessAudit`.
4. Fail hard on non-whitelisted path access.

## 4. Evidence and Conflict Rules

Evidence priority:

1. `file_change`
2. `tool_call / tool_result`
3. `assistant_text`
4. `user_text`

Conflict resolution:

1. Compare by `priority` first.
2. For same priority, compare by `confidence`.
3. If still tied, use the latest timestamp.
4. Keep winner and discarded evidence ids in conflict records.

## 5. Query and Time Parsing

1. Support bilingual time expressions (`today/yesterday/last 3 days` and Chinese equivalents).
2. Support project hint extraction (`in hopeNote`, `on paper project`, etc.).
3. Always resolve to absolute time ranges and persist them.

## 6. Insights Engine

1. Extract user instructions from timeline messages.
2. Cluster repetition into `exact_repeat` and `topic_repeat`.
3. Interpret repetition as `feature_polish`, `stuck_issue`, or `normal_iteration`.
4. Build phase-based natural-language timeline summaries.
5. Build feature deltas as explicit `before -> after` with evidence basis.

## 7. Prompt and LLM Policy

1. Prompt contract must remain activity-first (`what_you_did_first` first).
2. Auto-compress prompt for token budget to avoid overflow.
3. On generation failure, fall back to rule-based output and keep run usable.
4. Truncate runner stderr logs while preserving high-signal tail lines.

Codex runner defaults:

1. model: `gpt-5` (override: `WDYD_CODEX_MODEL`)
2. reasoning effort: `high` (override: `WDYD_CODEX_REASONING_EFFORT`)

## 8. Renderer Rules

1. Right panel prioritizes `What You Did`.
2. `Note/Raw Delta` is explicitly marked secondary.
3. HTML export follows the same activity-first layout.

## 9. Quality Gates

Every change must pass:

1. `npm run lint`
2. `npm test`
3. `npm run build`

Regression commands:

1. `proofline "what did I do yesterday on paper project?" --client codex --project paper`
2. `proofline "what did I do today?" --client codex --all-projects`
3. `proofline "what exactly did I change in hopeNote UI today? explain by file" --client codex --project hopenote`

## 10. Release Checklist

1. SOP docs and implementation stay aligned.
2. Prompt contract fields and renderer sections stay aligned.
3. Storage schema migrations remain backward compatible.
4. JSON/HTML export order matches TUI narrative order.
