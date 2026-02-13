# Proofline Product SOP

## 1. North Star

Help users answer, with evidence and in one screen inside their current client:

1. What did I do yesterday?
2. What did I do in the last 3 days?
3. What happened in project X, in sequence, and what changed after key events?

## 2. Product Guardrails

1. Single client per run.
2. No cross-client aggregation.
3. No full-disk fallback scan.
4. Activity-first narrative before file-level details.
5. Every claim must map to at least one evidence id; unproven claims are marked as inference.

## 3. User-Facing SOP (Runtime)

1. User asks in natural language: `proofline "what did I do yesterday on paper project?"`
2. Detect current client; if ambiguous, user selects one.
3. Discover projects edited in this client only.
4. Resolve time range from query and show exact boundaries.
5. If project is unclear, ask single project vs `ALL`.
6. Collect and score evidence.
7. Build timeline, major events, and after-action chains.
8. Show prompt preview before generation.
9. Generate with the same client CLI if supported.
10. Render activity-first output in terminal TUI.
11. Persist run/audit/evidence locally for export and replay.

## 4. Answer Quality Contract

Every answer should include, in this order:

1. Direct answer to the question.
2. What user did first (actions and sequence).
3. Instruction flow and repetition diagnosis.
4. Major events and after-actions.
5. File changes and note/raw deltas as secondary proof.
6. Confidence notes and unknowns.

## 5. Repetition Interpretation Rules

1. Repeated instructions + visible progress => `feature_polish`.
2. Repeated instructions + little/no progress => `stuck_issue`.
3. Low repetition or broad shifts => `normal_iteration`.

## 6. Scope Contract

1. Project scope comes from client-native traces only.
2. If user asks "which projects", return project-level breakdown.
3. If user asks a single project, default to that project only.

## 7. Versioning and Release

1. Keep naming and docs in English for public release.
2. Keep the legacy `wdyd` alias for compatibility while promoting `proofline`.
3. Ship with MIT license and reproducible CLI examples.
