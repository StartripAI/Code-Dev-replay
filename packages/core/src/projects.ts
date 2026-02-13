import { readFileSync } from "node:fs";
import { basename, normalize, resolve } from "node:path";
import { URL } from "node:url";
import type {
  ClientKind,
  ClientPaths,
  PathAccessAudit,
  ProjectCandidate,
  ProjectScope,
  QueryIntent,
  RawEvent,
} from "../../shared-types/src";
import { assertPathAllowed } from "./paths";
import { stableId } from "./utils";

interface CandidateAccumulator {
  root: string;
  name: string;
  signalScore: number;
  lastActiveAt: number;
  sources: Set<string>;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function maybeUriToPath(value: string): string {
  if (!value) return value;
  if (value.startsWith("file://")) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeRoot(input: string): string | null {
  if (!input) return null;
  const maybePath = maybeUriToPath(String(input));
  if (!maybePath.startsWith("/")) return null;
  return normalize(resolve(maybePath));
}

function pushCandidate(
  map: Map<string, CandidateAccumulator>,
  rootRaw: string,
  weight: number,
  ts: number,
  source: string,
): void {
  const root = normalizeRoot(rootRaw);
  if (!root) return;

  const existing = map.get(root);
  if (existing) {
    existing.signalScore += weight;
    existing.lastActiveAt = Math.max(existing.lastActiveAt, ts);
    existing.sources.add(source);
    return;
  }

  map.set(root, {
    root,
    name: basename(root) || root,
    signalScore: weight,
    lastActiveAt: ts,
    sources: new Set([source]),
  });
}

function scanWorkspaceJsonFile(
  file: string,
  paths: ClientPaths,
  audit: PathAccessAudit,
  map: Map<string, CandidateAccumulator>,
): void {
  assertPathAllowed(file, paths.roots, audit, "read");
  const value = safeJsonParse(readFileSync(file, "utf-8")) as { folder?: string; folders?: Array<{ uri?: string; path?: string }> } | null;
  if (!value) return;

  if (value.folder) {
    pushCandidate(map, value.folder, 3, Date.now(), "workspace.json:folder");
  }
  for (const folder of value.folders ?? []) {
    pushCandidate(map, folder.uri ?? folder.path ?? "", 2, Date.now(), "workspace.json:folders");
  }
}

function scanCodexGlobalStateFile(
  file: string,
  paths: ClientPaths,
  audit: PathAccessAudit,
  map: Map<string, CandidateAccumulator>,
): void {
  assertPathAllowed(file, paths.roots, audit, "read");
  const value = safeJsonParse(readFileSync(file, "utf-8")) as
    | {
        ["active-workspace-roots"]?: string[];
        ["electron-saved-workspace-roots"]?: string[];
      }
    | null;
  if (!value) return;

  for (const root of value["active-workspace-roots"] ?? []) {
    pushCandidate(map, root, 4, Date.now(), "codex-global:active");
  }
  for (const root of value["electron-saved-workspace-roots"] ?? []) {
    pushCandidate(map, root, 2, Date.now(), "codex-global:saved");
  }
}

function scanClaudeHistoryFile(
  file: string,
  paths: ClientPaths,
  audit: PathAccessAudit,
  map: Map<string, CandidateAccumulator>,
): void {
  assertPathAllowed(file, paths.roots, audit, "read");
  const lines = readFileSync(file, "utf-8").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    const row = safeJsonParse(line) as { project?: string; timestamp?: number } | null;
    if (!row?.project) continue;
    pushCandidate(map, row.project, 2, Number(row.timestamp ?? Date.now()), "claude:history");
  }
}

function scanPathsForProjects(client: ClientKind, paths: ClientPaths, audit: PathAccessAudit): Map<string, CandidateAccumulator> {
  const map = new Map<string, CandidateAccumulator>();

  for (const file of paths.files) {
    if (file.endsWith("workspace.json")) {
      scanWorkspaceJsonFile(file, paths, audit, map);
      continue;
    }
    if (client === "codex" && file.endsWith(".codex-global-state.json")) {
      scanCodexGlobalStateFile(file, paths, audit, map);
      continue;
    }
    if (client === "claude" && file.endsWith("history.jsonl")) {
      scanClaudeHistoryFile(file, paths, audit, map);
    }
  }

  return map;
}

function scanEventsForProjects(events: RawEvent[], map: Map<string, CandidateAccumulator>): void {
  for (const event of events) {
    const metadata = event.metadata ?? {};
    const candidates = [
      metadata.cwd,
      metadata.project,
      metadata.projectRoot,
      metadata.workspace,
      metadata.root,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        pushCandidate(map, candidate, 2, event.timestamp, "event:metadata");
      }
    }
  }
}

export function discoverProjects(
  client: ClientKind,
  paths: ClientPaths,
  events: RawEvent[],
  audit: PathAccessAudit,
): ProjectCandidate[] {
  const map = scanPathsForProjects(client, paths, audit);
  scanEventsForProjects(events, map);

  return [...map.values()]
    .map((item) => ({
      id: stableId(client, item.root),
      name: item.name,
      root: item.root,
      client,
      signalScore: Number(item.signalScore.toFixed(2)),
      lastActiveAt: item.lastActiveAt,
      sources: [...item.sources].sort(),
    }))
    .sort((a, b) => {
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      return b.lastActiveAt - a.lastActiveAt;
    });
}

export function matchProjects(candidates: ProjectCandidate[], hint: string): ProjectCandidate[] {
  const key = hint.trim().toLowerCase();
  if (!key) return [];
  return candidates
    .filter((project) => project.name.toLowerCase().includes(key) || project.root.toLowerCase().includes(key))
    .sort((a, b) => b.signalScore - a.signalScore);
}

export function defaultProjectScope(candidates: ProjectCandidate[], query: QueryIntent): ProjectScope | null {
  if (candidates.length === 0) return null;
  if (query.asksAllProjects) {
    return { mode: "all", projects: candidates };
  }
  if (query.projectHint) {
    const matched = matchProjects(candidates, query.projectHint);
    if (matched.length > 0) {
      return { mode: "single", project: matched[0] };
    }
  }
  if (!query.asksProject) {
    return { mode: "all", projects: candidates };
  }
  if (candidates.length === 1) {
    return { mode: "single", project: candidates[0] };
  }
  return null;
}

