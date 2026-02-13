import type { ClientPaths, DoctorCheck, RawEvent } from "../../shared-types/src";
import { readJson, readJsonl, makeRawEvent, withinSince, guardPath } from "./utils";
import type { Connector, ScanOptions } from "./types";

function readMessageTimestamp(item: Record<string, unknown>): unknown {
  const metadata = (item.metadata as Record<string, unknown> | undefined) ?? {};
  const time = (metadata.time as Record<string, unknown> | undefined) ?? {};
  return time.created ?? time.completed ?? item.timestamp ?? item.ts ?? Date.now();
}

function readMessageContent(item: Record<string, unknown>): unknown {
  const parts = item.parts;
  if (Array.isArray(parts)) return parts;
  return item.content ?? item;
}

export class OpenCodeConnector implements Connector {
  readonly client = "opencode" as const;

  async scan(paths: ClientPaths, options: ScanOptions): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    for (const file of paths.files) {
      if (file.endsWith(".jsonl")) {
        guardPath(file, paths.roots, options.audit, "read");
        const rows = readJsonl(file);
        for (const row of rows) {
          const item = row as Record<string, unknown>;
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: item.timestamp ?? item.ts ?? Date.now(),
            kind: "unknown",
            title: "opencode:jsonl",
            content: item,
          });
          if (withinSince(event.timestamp, options.sinceMs)) {
            events.push(event);
          }
        }
      } else if (file.endsWith(".json")) {
        guardPath(file, paths.roots, options.audit, "read");
        const item = readJson(file) as Record<string, unknown>;
        const isProject = file.includes("/storage/project/");
        const isSession = file.includes("/storage/session/");
        const isMessage = file.includes("/storage/message/");
        const isPart = file.includes("/storage/part/");

        if (isProject) {
          const projectRoot = String((item.worktree as string | undefined) ?? (item.path as string | undefined) ?? "");
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: (item.time as Record<string, unknown> | undefined)?.initialized ?? item.timestamp ?? Date.now(),
            kind: "system",
            title: "opencode:project",
            content: item,
            metadata: {
              projectRoot,
              projectId: item.id,
            },
          });
          if (withinSince(event.timestamp, options.sinceMs)) events.push(event);
          continue;
        }

        if (isSession) {
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: (item.time as Record<string, unknown> | undefined)?.updated ?? item.timestamp ?? Date.now(),
            kind: "system",
            title: "opencode:session",
            content: item,
            metadata: {
              sessionId: item.id,
              projectId: item.projectID,
              projectRoot: (item.path as Record<string, unknown> | undefined)?.root,
            },
          });
          if (withinSince(event.timestamp, options.sinceMs)) events.push(event);
          continue;
        }

        if (isMessage || isPart) {
          const role = String(item.role ?? "").toLowerCase();
          const kind: RawEvent["kind"] = role === "user" ? "user_message" : role === "assistant" ? "assistant_message" : "unknown";
          const ts = readMessageTimestamp(item);
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts,
            kind,
            title: `opencode:${role || "message"}`,
            content: readMessageContent(item),
            metadata: {
              sessionId: item.sessionID,
              projectId: (item.metadata as Record<string, unknown> | undefined)?.sessionID,
              projectRoot: ((item.metadata as Record<string, unknown> | undefined)?.assistant as Record<string, unknown> | undefined)?.path
                ? (((item.metadata as Record<string, unknown>)?.assistant as Record<string, unknown>)?.path as Record<string, unknown>)?.root
                : undefined,
            },
          });
          if (withinSince(event.timestamp, options.sinceMs)) {
            events.push(event);
          }

          const parts = item.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              const p = part as Record<string, unknown>;
              if (String(p.type ?? "") !== "tool-invocation") continue;
              const invocation = (p.toolInvocation as Record<string, unknown> | undefined) ?? {};
              const state = String(invocation.state ?? "");
              const toolKind: RawEvent["kind"] = state === "result" ? "tool_result" : "tool_use";
              const toolEvent = makeRawEvent({
                client: this.client,
                sourcePath: file,
                ts,
                kind: toolKind,
                title: `opencode:${toolKind}:${String(invocation.toolName ?? "unknown")}`,
                content: invocation,
                metadata: {
                  sessionId: item.sessionID,
                  toolName: invocation.toolName,
                  toolCallId: invocation.toolCallId,
                  projectRoot: ((item.metadata as Record<string, unknown> | undefined)?.assistant as Record<string, unknown> | undefined)?.path
                    ? (((item.metadata as Record<string, unknown>)?.assistant as Record<string, unknown>)?.path as Record<string, unknown>)?.root
                    : undefined,
                },
              });
              if (withinSince(toolEvent.timestamp, options.sinceMs)) {
                events.push(toolEvent);
              }
            }
          }
          continue;
        }

        const event = makeRawEvent({
          client: this.client,
          sourcePath: file,
          ts: item.timestamp ?? item.ts ?? Date.now(),
          kind: "unknown",
          title: "opencode:json",
          content: item,
        });
        if (withinSince(event.timestamp, options.sinceMs)) events.push(event);
      }
    }

    return events;
  }

  async doctor(paths: ClientPaths): Promise<DoctorCheck[]> {
    return [
      {
        ok: paths.files.length > 0,
        message: paths.files.length > 0 ? `found ${paths.files.length} OpenCode files` : "no OpenCode files found",
      },
    ];
  }
}
