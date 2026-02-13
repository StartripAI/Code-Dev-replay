#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, normalize, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  CLIENT_KINDS,
  type AnalysisInsights,
  type ClientKind,
  type EvidenceItem,
  type ExportPayload,
  type GenerationResult,
  type ProjectCandidate,
  type ProjectScope,
  type RunContext,
  type RunOutput,
  type TimelineEvent,
} from "../../../packages/shared-types/src";
import {
  buildReplaySegments,
  collectEvidence,
  createAudit,
  defaultProjectScope,
  detectClient,
  discoverProjects,
  analyzeInsights,
  isClientKind,
  matchProjects,
  normalize as normalizeEvents,
  parseDurationToMs,
  parseQuery,
  resolveConflicts,
  resolvePaths,
  stableId,
  uniq,
} from "../../../packages/core/src";
import { getConnector } from "../../../packages/connectors/src";
import { buildActionChains, bootstrapRulesFromTimeline, classifyEvents, DEFAULT_RULES } from "../../../packages/event-engine/src";
import { renderProjectSelection, renderPromptPreview, renderTUI } from "../../../packages/renderer-tui/src";
import { WDYDStorage } from "../../../packages/storage/src";
import { getRunnerCapability, runClientLLM } from "../../../packages/client-runners/src";
import { buildStandardPrompt } from "../../../packages/prompt-pack/src";

type Command = "run" | "detect" | "doctor" | "export";

interface ParsedArgs {
  command: Command;
  client?: ClientKind;
  sinceMs?: number;
  out?: string;
  format?: "html" | "json";
  question?: string;
  projectHint?: string;
  allProjects: boolean;
  noGenerate: boolean;
  autoGenerate: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const commands: ReadonlySet<string> = new Set(["run", "detect", "doctor", "export"]);
  let command: Command = "run";
  let tokens = argv;
  if (commands.has(argv[0] ?? "")) {
    command = argv[0] as Command;
    tokens = argv.slice(1);
  }

  let client: ClientKind | undefined;
  let sinceMs: number | undefined;
  let out: string | undefined;
  let format: "html" | "json" | undefined;
  let projectHint: string | undefined;
  let allProjects = false;
  let noGenerate = false;
  let autoGenerate = false;
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const arg = tokens[i];
    if (arg === "--client" && tokens[i + 1]) {
      const next = tokens[i + 1];
      client = isClientKind(next) ? next : undefined;
      i += 1;
      continue;
    }
    if (arg === "--since" && tokens[i + 1]) {
      sinceMs = parseDurationToMs(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out" && tokens[i + 1]) {
      out = tokens[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--format" && tokens[i + 1]) {
      const next = tokens[i + 1];
      format = next === "json" || next === "html" ? next : undefined;
      i += 1;
      continue;
    }
    if (arg === "--project" && tokens[i + 1]) {
      projectHint = tokens[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--all-projects") {
      allProjects = true;
      continue;
    }
    if (arg === "--no-generate") {
      noGenerate = true;
      continue;
    }
    if (arg === "--auto-generate") {
      autoGenerate = true;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positionals.push(arg);
  }

  return {
    command,
    client,
    sinceMs,
    out,
    format,
    question: positionals.length > 0 ? positionals.join(" ").trim() : undefined,
    projectHint,
    allProjects,
    noGenerate,
    autoGenerate,
  };
}

function storagePath(): string {
  const current = resolve(homedir(), ".proofline", "proofline.db");
  const legacyDevReplay = resolve(homedir(), ".devreplay", "devreplay.db");
  const legacyWDYD = resolve(homedir(), ".wdyd", "wdyd.db");
  if (existsSync(current)) return current;
  if (existsSync(legacyDevReplay)) return legacyDevReplay;
  if (existsSync(legacyWDYD)) return legacyWDYD;
  return current;
}

async function selectClientInteractively(candidates: ClientKind[]): Promise<ClientKind> {
  const options = candidates.length > 0 ? candidates : [...CLIENT_KINDS];
  const rl = createInterface({ input: stdin, output: stdout });
  stdout.write("\nSelect active client for this run:\n");
  options.forEach((client, idx) => {
    stdout.write(`  ${idx + 1}. ${client}\n`);
  });
  const answer = await rl.question(`Enter number [1-${options.length}]: `);
  rl.close();
  const picked = Number(answer);
  const index = Number.isFinite(picked) ? Math.max(1, Math.min(options.length, picked)) - 1 : 0;
  return options[index];
}

async function resolveSingleClient(forced?: ClientKind): Promise<{ client: ClientKind; selectedBy: RunContext["selectedBy"]; reason: string }> {
  const detected = detectClient({ forcedClient: forced });
  if (detected.client) {
    return {
      client: detected.client,
      selectedBy: detected.selectedBy,
      reason: detected.reason,
    };
  }

  const selected = await selectClientInteractively(detected.candidates);
  return {
    client: selected,
    selectedBy: "manual",
    reason: `manual selection (${detected.reason})`,
  };
}

function scopeRoots(scope: ProjectScope): string[] {
  return scope.mode === "single" ? [scope.project.root] : scope.projects.map((x) => x.root);
}

function isWithinRoot(pathOrRoot: string, root: string): boolean {
  const normalizedPath = normalize(resolve(pathOrRoot));
  const normalizedRoot = normalize(resolve(root));
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function eventBelongsToScope(event: TimelineEvent, scope: ProjectScope): boolean {
  const rawRoot = String(event.metadata.projectRoot ?? event.metadata.cwd ?? event.metadata.project ?? "");
  if (!rawRoot) return true;

  if (scope.mode === "single") {
    return isWithinRoot(rawRoot, scope.project.root);
  }

  return scope.projects.some((project) => isWithinRoot(rawRoot, project.root));
}

function filterTimeline(timeline: TimelineEvent[], range: { start: number; end: number }, scope: ProjectScope): TimelineEvent[] {
  return timeline.filter((event) => event.ts >= range.start && event.ts <= range.end && eventBelongsToScope(event, scope));
}

function resolveGenerationResult(
  parsed: ParsedArgs,
  client: ClientKind,
  prompt: string,
  scope: ProjectScope,
  allowGenerate: boolean,
  reason: string,
  audit: ReturnType<typeof createAudit>,
): GenerationResult {
  if (parsed.noGenerate) {
    return {
      supported: false,
      status: "skipped",
      output: "",
      error: "generation disabled by --no-generate",
    };
  }

  if (!allowGenerate) {
    return {
      supported: false,
      status: "skipped",
      output: "",
      error: reason,
    };
  }

  const capability = getRunnerCapability(client);
  if (!capability.supported) {
    return {
      supported: false,
      status: "unsupported",
      output: "",
      error: capability.reason,
    };
  }

  return runClientLLM(client, prompt, scope, audit);
}

function narrowScopeByEvidence(scope: ProjectScope, evidence: EvidenceItem[]): ProjectScope {
  if (scope.mode !== "all" || scope.projects.length === 0) {
    return scope;
  }

  const active = new Set<string>();
  for (const item of evidence) {
    if (!item.projectId) continue;
    active.add(item.projectId);
  }

  const filtered = scope.projects.filter((project) => active.has(project.id));
  if (filtered.length === 0) {
    return { mode: "all", projects: [] };
  }

  return { mode: "all", projects: filtered };
}

function projectNameMap(scope?: ProjectScope): Map<string, string> {
  const map = new Map<string, string>();
  if (!scope) return map;
  if (scope.mode === "single") {
    map.set(scope.project.id, scope.project.name);
    return map;
  }
  for (const project of scope.projects) {
    map.set(project.id, project.name);
  }
  return map;
}

function buildProjectActivityHighlights(evidence: EvidenceItem[], scope?: ProjectScope): string[] {
  const idToName = projectNameMap(scope);
  const stats = new Map<string, { evidence: number; fileChange: number; tool: number }>();

  for (const item of evidence) {
    const projectName = item.projectId ? idToName.get(item.projectId) ?? item.projectId : "unknown";
    const row = stats.get(projectName) ?? { evidence: 0, fileChange: 0, tool: 0 };
    row.evidence += 1;
    if (item.type === "file_change") row.fileChange += 1;
    if (item.type === "tool_call" || item.type === "tool_result") row.tool += 1;
    stats.set(projectName, row);
  }

  return [...stats.entries()]
    .sort((a, b) => b[1].evidence - a[1].evidence)
    .slice(0, 4)
    .map(
      ([name, row]) =>
        `${name}: evidence ${row.evidence}, tool actions ${row.tool}, file changes ${row.fileChange}`,
    );
}

function buildActivityFirstHighlights(insights?: AnalysisInsights): string[] {
  if (!insights) return [];

  const lines: string[] = [];
  for (const segment of insights.timelineNarrative.slice(0, 3)) {
    lines.push(`${segment.title}: ${segment.summary}`);
  }
  for (const cluster of insights.repetition.slice(0, 2)) {
    lines.push(`repetition diagnosis ${cluster.topic} x${cluster.count}: ${cluster.interpretation}`);
  }
  return lines;
}

function buildFileChangeSecondaryHighlights(insights?: AnalysisInsights): string[] {
  if (!insights) return [];

  const lines: string[] = [];
  for (const delta of insights.featureDeltas.slice(0, 4)) {
    lines.push(`${delta.area}: ${delta.before} -> ${delta.after}`);
  }
  return lines;
}

function buildHtmlReport(payload: ExportPayload): string {
  const major = payload.majorEvents
    .map(
      (event) => `
      <article class="event ${event.type.toLowerCase()}">
        <header>
          <span class="badge">${event.type}</span>
          <time>${new Date(event.ts).toLocaleString()}</time>
        </header>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.summary)}</p>
      </article>`,
    )
    .join("\n");

  const timeline = payload.timeline
    .slice(0, 2000)
    .map(
      (event) => `
      <li>
        <time>${new Date(event.ts).toLocaleString()}</time>
        <strong>${escapeHtml(event.label)}</strong>
        <p>${escapeHtml(event.detail)}</p>
      </li>`,
    )
    .join("\n");

  const instructionBlocks = (payload.insights?.instructions ?? [])
    .slice(0, 30)
    .map(
      (item, idx) => `
      <li>
        <time>${new Date(item.ts).toLocaleTimeString()}</time>
        <strong>#${idx + 1}</strong>
        <p>${escapeHtml(item.text)}</p>
      </li>`,
    )
    .join("\n");

  const repetitionBlocks = (payload.insights?.repetition ?? [])
    .slice(0, 12)
    .map(
      (item) => `
      <article class="event">
        <header>
          <span class="badge">${escapeHtml(item.kind)}</span>
          <time>x${item.count}</time>
        </header>
        <h3>${escapeHtml(item.topic)}</h3>
        <p>${escapeHtml(item.interpretation)}</p>
      </article>`,
    )
    .join("\n");

  const deltaBlocks = (payload.insights?.featureDeltas ?? [])
    .slice(0, 12)
    .map(
      (item) => `
      <article class="event">
        <header>
          <span class="badge">${escapeHtml(item.area)}</span>
          <time>confidence ${item.confidence}</time>
        </header>
        <p><strong>Before:</strong> ${escapeHtml(item.before)}</p>
        <p><strong>After:</strong> ${escapeHtml(item.after)}</p>
      </article>`,
    )
    .join("\n");

  const narrativeBlocks = (payload.insights?.timelineNarrative ?? [])
    .slice(0, 8)
    .map(
      (item) => `
      <article class="event">
        <header>
          <span class="badge">${escapeHtml(item.title)}</span>
          <time>${new Date(item.start).toLocaleString()} - ${new Date(item.end).toLocaleString()}</time>
        </header>
        <p>${escapeHtml(item.summary)}</p>
      </article>`,
    )
    .join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Proofline Report (${payload.context.client})</title>
  <style>
    :root {
      --bg: #08121f;
      --panel: #0f1d30;
      --text: #e7edf6;
      --muted: #8ea3c1;
      --goal: #2ecc71;
      --warn: #f1c40f;
      --risk: #e74c3c;
      --line: #1f3552;
    }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system; background: radial-gradient(circle at top, #10253f, var(--bg)); color: var(--text); }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .hero { background: linear-gradient(135deg, #102847, #0e1f33); border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
    .grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-top: 16px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    .events { display: grid; gap: 10px; }
    .event { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: #0d1a2d; }
    .event header { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 12px; }
    .badge { padding: 2px 8px; border-radius: 999px; background: #1f3552; font-weight: 700; }
    .event.goal .badge { background: color-mix(in srgb, var(--goal) 30%, #1f3552); }
    .event.yellow_card .badge, .event.penalty .badge { background: color-mix(in srgb, var(--warn) 35%, #1f3552); }
    .event.red_card .badge { background: color-mix(in srgb, var(--risk) 35%, #1f3552); }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; max-height: 70vh; overflow: auto; }
    li { border-left: 3px solid #2d4f79; padding-left: 10px; }
    time { color: var(--muted); font-size: 12px; }
    p { margin: 6px 0 0; color: #d0d9e7; }
    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>Proofline Match Desk Report</h1>
      <p>Client: <strong>${payload.context.client}</strong> | Query: ${escapeHtml(payload.query?.raw ?? "n/a")}</p>
      <p>Range: ${new Date(payload.context.startedAt).toLocaleString()} → ${new Date(payload.context.endedAt).toLocaleString()}</p>
      <p>Timeline: ${payload.timeline.length} | Major: ${payload.majorEvents.length} | Evidence: ${payload.evidence.length}</p>
    </section>

    <section class="grid">
      <section class="panel">
        <h2>Major Events</h2>
        <div class="events">${major}</div>
      </section>

      <section class="panel">
        <h2>Timeline (first 2000)</h2>
        <ul>${timeline}</ul>
      </section>
    </section>

    <section class="grid">
      <section class="panel">
        <h2>Instruction Flow</h2>
        <ul>${instructionBlocks}</ul>
      </section>
      <section class="panel">
        <h2>Repetition Diagnosis</h2>
        <div class="events">${repetitionBlocks}</div>
      </section>
    </section>

    <section class="grid">
      <section class="panel">
        <h2>Narrative Timeline (What You Did)</h2>
        <div class="events">${narrativeBlocks}</div>
      </section>
      <section class="panel">
        <h2>Note/Raw Deltas (Secondary)</h2>
        <div class="events">${deltaBlocks}</div>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function chooseProjectScope(
  queryText: string,
  candidates: ProjectCandidate[],
  parsed: ParsedArgs,
  askProject: boolean,
): Promise<ProjectScope> {
  if (candidates.length === 0) {
    return { mode: "all", projects: [] };
  }

  if (parsed.allProjects) {
    return { mode: "all", projects: candidates };
  }

  if (parsed.projectHint) {
    const matched = matchProjects(candidates, parsed.projectHint);
    if (matched.length > 0) {
      return { mode: "single", project: matched[0] };
    }
  }

  if (askProject && candidates.length > 1) {
    const selected = await renderProjectSelection(queryText, candidates);
    if (selected.mode === "all") {
      return { mode: "all", projects: candidates };
    }
    return { mode: "single", project: candidates[selected.index] };
  }

  if (candidates.length === 1) {
    return { mode: "single", project: candidates[0] };
  }

  return { mode: "all", projects: candidates };
}

async function runCommand(parsed: ParsedArgs): Promise<void> {
  const question = parsed.question?.trim() || "what did I do yesterday?";
  const now = Date.now();
  const query = parseQuery(question, now);
  if (parsed.sinceMs) {
    query.timeRange = {
      start: now - parsed.sinceMs,
      end: now,
      label: `flag_since_${parsed.sinceMs}`,
      source: "flag",
    };
  }

  const resolved = await resolveSingleClient(parsed.client);
  const audit = createAudit(resolved.client);
  const paths = resolvePaths(resolved.client, audit);
  const connector = getConnector(resolved.client);

  const scanSinceMs = Math.max(0, now - query.timeRange.start);
  const rawEvents = await connector.scan(paths, { sinceMs: scanSinceMs, audit });
  const discovered = discoverProjects(resolved.client, paths, rawEvents, audit);
  const candidates = discovered;
  const defaultScope = defaultProjectScope(candidates, query);
  const preliminaryScope =
    defaultScope ??
    (await chooseProjectScope(
      query.raw,
      candidates,
      parsed,
      query.asksProject,
    ));

  const timelineAll = normalizeEvents(rawEvents);
  const allowedRoots = uniq([...paths.roots, ...scopeRoots(preliminaryScope)]);
  const evidenceCollected = collectEvidence({
    client: resolved.client,
    query,
    scope: preliminaryScope,
    range: query.timeRange,
    rawEvents,
    timeline: timelineAll,
    audit,
    allowedRoots,
  });
  const { evidence, conflicts } = resolveConflicts(evidenceCollected);
  const scope = narrowScopeByEvidence(preliminaryScope, evidence);
  const timeline = filterTimeline(timelineAll, query.timeRange, scope);
  const rules = bootstrapRulesFromTimeline(timeline);
  const majorEvents = await classifyEvents(timeline, {
    rules: rules.length > 0 ? rules : DEFAULT_RULES,
    followUpWindow: 20,
    followUpCount: 8,
  });
  const actionChains = buildActionChains(timeline, majorEvents, evidence);
  const replay = buildReplaySegments(timeline, majorEvents, 6, 16);
  const insights = analyzeInsights({
    query,
    scope,
    timeline,
    evidence,
    majorEvents,
  });

  const promptPreview = buildStandardPrompt({
    query,
    scope,
    timeline,
    majorEvents,
    actionChains,
    conflicts,
    insights,
  });
  const shouldGenerate = parsed.noGenerate
    ? false
    : parsed.autoGenerate || !stdout.isTTY || !stdin.isTTY
      ? true
      : await renderPromptPreview(promptPreview);
  const generation = resolveGenerationResult(
    parsed,
    resolved.client,
    promptPreview.prompt,
    scope,
    shouldGenerate,
    "generation not confirmed",
    audit,
  );

  const finalRoots = uniq([...paths.roots, ...scopeRoots(scope)]);

  const context: RunContext = {
    runId: stableId(resolved.client, now, Math.random()),
    client: resolved.client,
    startedAt: timeline[0]?.ts ?? query.timeRange.start,
    endedAt: timeline[timeline.length - 1]?.ts ?? query.timeRange.end,
    sinceMs: parsed.sinceMs,
    selectedBy: resolved.selectedBy,
    dataRoots: finalRoots,
    query,
    projectScope: scope,
  };

  const output: RunOutput = {
    context,
    query,
    projectScope: scope,
    rawEvents,
    timeline,
    majorEvents,
    actionChains,
    evidence,
    conflicts,
    insights,
    promptPreview,
    generation,
    replay,
    audit,
  };

  const storage = new WDYDStorage(storagePath());
  storage.saveRun(output);
  const payload = storage.loadLatest(resolved.client);
  storage.close();

  if (!payload) {
    throw new Error("failed to load stored run");
  }

  stdout.write(`\n[proofline] active client: ${resolved.client} (${resolved.reason})\n`);
  stdout.write(`[proofline] query: ${query.raw}\n`);
  stdout.write(`[proofline] time range: ${new Date(query.timeRange.start).toLocaleString()} -> ${new Date(query.timeRange.end).toLocaleString()}\n`);
  stdout.write(`[proofline] scope: ${scope.mode === "single" ? scope.project.name : `ALL (${scope.projects.length})`}\n`);
  stdout.write(`[proofline] scanned: raw=${rawEvents.length}, timeline=${timeline.length}, major=${majorEvents.length}, evidence=${evidence.length}\n`);
  stdout.write(
    `[proofline] insights: instructions=${insights.instructions.length}, repetition=${insights.repetition.length}, deltas=${insights.featureDeltas.length}\n`,
  );
  stdout.write(`[proofline] generation: ${generation.status}${generation.error ? ` (${generation.error})` : ""}\n\n`);

  const whatYouDid = buildActivityFirstHighlights(insights);
  if (whatYouDid.length > 0) {
    stdout.write("[proofline] what you did (activity-first):\n");
    for (const line of whatYouDid) {
      stdout.write(`  - ${line}\n`);
    }
  }

  const projectHighlights = buildProjectActivityHighlights(evidence, scope);
  if (projectHighlights.length > 0) {
    stdout.write("[proofline] project activity:\n");
    for (const line of projectHighlights) {
      stdout.write(`  - ${line}\n`);
    }
  }

  const fileHighlights = buildFileChangeSecondaryHighlights(insights);
  if (fileHighlights.length > 0) {
    stdout.write("[proofline] file changes (secondary):\n");
    for (const line of fileHighlights) {
      stdout.write(`  - ${line}\n`);
    }
    stdout.write("\n");
  }

  await renderTUI({ payload });
}

async function detectCommand(parsed: ParsedArgs): Promise<void> {
  const detected = detectClient({ forcedClient: parsed.client });
  stdout.write(`${JSON.stringify(detected, null, 2)}\n`);
}

async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const resolved = await resolveSingleClient(parsed.client);
  const audit = createAudit(resolved.client);
  const paths = resolvePaths(resolved.client, audit);
  const connector = getConnector(resolved.client);
  const checks = await connector.doctor(paths, audit);

  const lines = [
    `Client: ${resolved.client}`,
    `Reason: ${resolved.reason}`,
    `Whitelisted roots:`,
    ...paths.roots.map((root) => `  - ${root}`),
    `Discovered files: ${paths.files.length}`,
    ...checks.map((check) => `${check.ok ? "[OK]" : "[FAIL]"} ${check.message}${check.path ? ` (${check.path})` : ""}`),
    `Audit records: ${audit.records.length}`,
  ];
  stdout.write(`${lines.join("\n")}\n`);
}

function exportPayloadToFile(payload: ExportPayload, outPath: string, format: "html" | "json"): void {
  mkdirSync(dirname(outPath), { recursive: true });
  if (format === "json") {
    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
    return;
  }
  writeFileSync(outPath, buildHtmlReport(payload), "utf-8");
}

async function exportCommand(parsed: ParsedArgs): Promise<void> {
  if (!parsed.out) {
    throw new Error("export requires --out <path>");
  }

  const resolved = await resolveSingleClient(parsed.client);
  const storage = new WDYDStorage(storagePath());
  const payload = storage.loadLatest(resolved.client);
  storage.close();
  if (!payload) {
    throw new Error(`no stored run for client: ${resolved.client}`);
  }

  const outPath = resolve(parsed.out);
  const format = parsed.format ?? (outPath.endsWith(".json") ? "json" : "html");
  exportPayloadToFile(payload, outPath, format);
  stdout.write(`[proofline] exported ${format.toUpperCase()} report to ${outPath}\n`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "detect") {
    await detectCommand(parsed);
    return;
  }
  if (parsed.command === "doctor") {
    await doctorCommand(parsed);
    return;
  }
  if (parsed.command === "export") {
    await exportCommand(parsed);
    return;
  }

  await runCommand(parsed);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[proofline] ERROR: ${message}`);
  process.exitCode = 1;
});
