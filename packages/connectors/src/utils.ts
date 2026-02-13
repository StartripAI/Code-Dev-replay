import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { assertPathAllowed } from "../../core/src";
import type { ClientKind, PathAccessAudit, RawEvent, RawEventKind } from "../../shared-types/src";
import { stableId, toTimestamp } from "../../core/src";

export function preview(input: unknown, max = 220): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function readJsonl(filePath: string): unknown[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { _rawLine: line };
      }
    });
}

export function readJson(filePath: string): unknown {
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

export function makeRawEvent(args: {
  client: ClientKind;
  sourcePath: string;
  ts: unknown;
  kind: RawEventKind;
  title: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}): RawEvent {
  const timestamp = toTimestamp(args.ts);
  return {
    id: stableId(args.client, args.sourcePath, args.kind, timestamp, args.title, preview(args.content, 512)),
    client: args.client,
    sourcePath: args.sourcePath,
    timestamp,
    kind: args.kind,
    title: args.title,
    content: preview(args.content, 1200),
    metadata: {
      file: basename(args.sourcePath),
      ...(args.metadata ?? {}),
    },
  };
}

export function withinSince(ts: number, sinceMs?: number): boolean {
  if (!sinceMs) return true;
  return ts >= Date.now() - sinceMs;
}

export function guardPath(filePath: string, roots: string[], audit: PathAccessAudit, action: "read" | "glob" | "sqlite"): void {
  assertPathAllowed(filePath, roots, audit, action);
}
