import type { ClientPaths, DoctorCheck, RawEvent } from "../../shared-types/src";
import { withinSince, readJsonl, makeRawEvent, guardPath, preview } from "./utils";
import type { Connector, ScanOptions } from "./types";

export class ClaudeConnector implements Connector {
  readonly client = "claude" as const;

  async scan(paths: ClientPaths, options: ScanOptions): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    for (const file of paths.files.filter((f) => f.endsWith(".jsonl"))) {
      guardPath(file, paths.roots, options.audit, "read");
      const rows = readJsonl(file);
      for (const row of rows) {
        const item = row as Record<string, unknown>;
        const type = String(item.type ?? "unknown").toLowerCase();
        const kind = type === "user" ? "user_message" : type === "assistant" ? "assistant_message" : type === "progress" ? "progress" : "unknown";
        const message = (item.message as Record<string, unknown> | undefined) ?? {};
        const content = message.content ?? item.message ?? item.data ?? item;
        const contentBlocks = Array.isArray(message.content) ? message.content : [];

        const event = makeRawEvent({
          client: this.client,
          sourcePath: file,
          ts: item.timestamp,
          kind,
          title: `claude:${type}`,
          content,
          metadata: {
            type,
            cwd: item.cwd,
            project: item.project,
            projectRoot: item.project ?? item.cwd,
            sessionId: item.sessionId,
            uuid: item.uuid,
            parentUuid: item.parentUuid,
          },
        });

        if (withinSince(event.timestamp, options.sinceMs)) {
          events.push(event);
        }

        // Extract tool usage blocks from assistant/user content arrays.
        for (const block of contentBlocks) {
          const asBlock = block as Record<string, unknown>;
          const blockType = String(asBlock.type ?? "").toLowerCase();
          if (blockType !== "tool_use" && blockType !== "tool_result") continue;

          const toolEvent = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: item.timestamp,
            kind: blockType === "tool_use" ? "tool_use" : "tool_result",
            title: `claude:${blockType}:${String(asBlock.name ?? asBlock.tool_name ?? "unknown")}`,
            content: asBlock.input ?? asBlock.content ?? asBlock.result ?? asBlock,
            metadata: {
              type,
              blockType,
              toolName: asBlock.name ?? asBlock.tool_name,
              toolUseId: asBlock.id ?? asBlock.tool_use_id,
              cwd: item.cwd,
              project: item.project,
              projectRoot: item.project ?? item.cwd,
              sessionId: item.sessionId,
            },
          });
          if (withinSince(toolEvent.timestamp, options.sinceMs)) {
            events.push(toolEvent);
          }
        }
      }
    }

    return events;
  }

  async doctor(paths: ClientPaths): Promise<DoctorCheck[]> {
    return [
      {
        ok: paths.files.length > 0,
        message: paths.files.length > 0 ? `found ${paths.files.length} Claude files` : "no Claude files found",
      },
    ];
  }
}
