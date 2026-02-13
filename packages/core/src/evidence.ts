import { readdirSync, statSync } from "node:fs";
import { join, normalize, resolve, relative } from "node:path";
import type {
  ClientKind,
  EvidenceConflict,
  EvidenceItem,
  ProjectScope,
  QueryIntent,
  TimelineEvent,
  RawEvent,
  TimeRange,
  PathAccessAudit,
} from "../../shared-types/src";
import { assertPathAllowed } from "./paths";
import { stableId } from "./utils";

interface CollectEvidenceInput {
  client: ClientKind;
  query: QueryIntent;
  scope: ProjectScope;
  range: TimeRange;
  rawEvents: RawEvent[];
  timeline: TimelineEvent[];
  audit: PathAccessAudit;
  allowedRoots: string[];
}

function evidenceTypeFromTimelineEvent(event: TimelineEvent): EvidenceItem["type"] {
  const tags = event.tags.join(" ").toLowerCase();
  const label = `${event.label} ${event.detail}`.toLowerCase();
  if (tags.includes("file_change")) return "file_change";
  if (tags.includes("tool_result") || label.includes("function_call_output")) return "tool_result";
  if (tags.includes("tool_use") || label.includes("function_call")) return "tool_call";
  if (event.actor === "assistant") return "assistant_text";
  if (event.actor === "user") return "user_text";
  return "system";
}

function priorityOf(type: EvidenceItem["type"]): number {
  switch (type) {
    case "file_change":
      return 6;
    case "tool_call":
    case "tool_result":
      return 5;
    case "assistant_text":
      return 4;
    case "user_text":
      return 3;
    default:
      return 2;
  }
}

function confidenceOf(type: EvidenceItem["type"]): number {
  switch (type) {
    case "file_change":
      return 0.95;
    case "tool_call":
    case "tool_result":
      return 0.9;
    case "assistant_text":
      return 0.82;
    case "user_text":
      return 0.72;
    default:
      return 0.6;
  }
}

function scopeRoots(scope: ProjectScope): string[] {
  if (scope.mode === "single") return [scope.project.root];
  return scope.projects.map((x) => x.root);
}

function matchProjectId(scope: ProjectScope, pathOrRoot: string | undefined): string | undefined {
  if (!pathOrRoot) return undefined;
  const normalized = normalize(resolve(pathOrRoot));
  if (scope.mode === "single") {
    return normalized.startsWith(scope.project.root) ? scope.project.id : undefined;
  }
  for (const project of scope.projects) {
    if (normalized.startsWith(project.root)) return project.id;
  }
  return undefined;
}

function pushTimelineEvidence(input: CollectEvidenceInput, out: EvidenceItem[]): void {
  for (const event of input.timeline) {
    if (event.ts < input.range.start || event.ts > input.range.end) continue;

    const projectId = matchProjectId(
      input.scope,
      String(event.metadata.cwd ?? event.metadata.projectRoot ?? event.metadata.project ?? ""),
    );
    if (input.scope.mode === "single" && projectId && projectId !== input.scope.project.id) {
      continue;
    }

    const type = evidenceTypeFromTimelineEvent(event);
    out.push({
      id: stableId(input.client, "timeline", event.id, type),
      client: input.client,
      projectId,
      ts: event.ts,
      type,
      sourcePath: event.sourcePath,
      summary: event.label,
      detail: event.detail,
      confidence: confidenceOf(type),
      priority: priorityOf(type),
      eventId: event.id,
      metadata: {
        actor: event.actor,
        tags: event.tags,
      },
    });
  }
}

function walkChangedFiles(
  root: string,
  range: TimeRange,
  audit: PathAccessAudit,
  allowedRoots: string[],
  maxFiles: number,
): Array<{ path: string; mtime: number }> {
  const queue: string[] = [root];
  const out: Array<{ path: string; mtime: number }> = [];
  const denyNames = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.pop()!;
    assertPathAllowed(current, allowedRoots, audit, "scan");

    let entries: Array<{ name: string | Buffer; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Array<{
        name: string | Buffer;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      if (denyNames.has(entryName)) continue;
      const full = join(current, entryName);
      assertPathAllowed(full, allowedRoots, audit, "scan");

      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      const mtime = stat.mtimeMs;
      if (mtime >= range.start && mtime <= range.end) {
        out.push({ path: full, mtime });
        if (out.length >= maxFiles) break;
      }
    }
  }

  return out.sort((a, b) => a.mtime - b.mtime);
}

function pushFileChangeEvidence(input: CollectEvidenceInput, out: EvidenceItem[]): void {
  const roots = scopeRoots(input.scope);
  const maxFiles = 600;
  for (const root of roots) {
    const projectId = matchProjectId(input.scope, root);
    const changed = walkChangedFiles(root, input.range, input.audit, input.allowedRoots, maxFiles);
    for (const file of changed) {
      out.push({
        id: stableId(input.client, "file_change", file.path, file.mtime),
        client: input.client,
        projectId,
        ts: file.mtime,
        type: "file_change",
        sourcePath: file.path,
        summary: `changed ${relative(root, file.path)}`,
        detail: `filesystem mtime changed within ${input.range.label}`,
        confidence: 0.97,
        priority: 6,
        metadata: {
          root,
          inferred: true,
          query: input.query.raw,
        },
      });
    }
  }
}

export function collectEvidence(input: CollectEvidenceInput): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  pushTimelineEvidence(input, evidence);
  pushFileChangeEvidence(input, evidence);
  return evidence.sort((a, b) => a.ts - b.ts);
}

export function resolveConflicts(items: EvidenceItem[]): { evidence: EvidenceItem[]; conflicts: EvidenceConflict[] } {
  const byKey = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const bucket = Math.floor(item.ts / 60_000);
    const key = `${bucket}|${item.projectId ?? "-"}|${item.summary.toLowerCase()}`;
    const arr = byKey.get(key) ?? [];
    arr.push(item);
    byKey.set(key, arr);
  }

  const kept: EvidenceItem[] = [];
  const conflicts: EvidenceConflict[] = [];

  for (const group of byKey.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ranked = [...group].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.ts - a.ts;
    });

    const winner = ranked[0];
    kept.push(winner);
    conflicts.push({
      id: stableId("conflict", winner.id, ranked.length),
      winnerEvidenceId: winner.id,
      discardedEvidenceIds: ranked.slice(1).map((x) => x.id),
      reason: "priority_rule:file_change>tool>assistant>user",
      confidence: winner.confidence,
    });
  }

  return {
    evidence: kept.sort((a, b) => a.ts - b.ts),
    conflicts,
  };
}
