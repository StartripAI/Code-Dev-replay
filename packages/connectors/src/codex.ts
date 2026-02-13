import type { ClientPaths, DoctorCheck, RawEvent } from "../../shared-types/src";
import { withinSince, readJsonl, makeRawEvent, guardPath } from "./utils";
import type { Connector, ScanOptions } from "./types";

export class CodexConnector implements Connector {
  readonly client = "codex" as const;

  async scan(paths: ClientPaths, options: ScanOptions): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    for (const file of paths.files.filter((f) => f.endsWith(".jsonl"))) {
      guardPath(file, paths.roots, options.audit, "read");
      const rows = readJsonl(file);
      let currentCwd: string | undefined;
      let currentSessionId: string | undefined;

      for (const row of rows) {
        const item = row as Record<string, unknown>;
        const rawType = String(item.type ?? "").toLowerCase();
        const payload = (item.payload as Record<string, unknown> | undefined) ?? {};
        const payloadType = String(payload.type ?? "").toLowerCase();
        const sessionId = (item.session_id as string | undefined) ?? currentSessionId;
        if (item.session_id && typeof item.session_id === "string") {
          currentSessionId = item.session_id;
        }
        if (rawType === "turn_context" && typeof payload.cwd === "string") {
          currentCwd = payload.cwd;
        }

        let kind: RawEvent["kind"] = "unknown";
        let title = `codex:${rawType || "unknown"}`;
        let content: unknown = payload.message ?? payload.text ?? item.text ?? payload;

        if ("session_id" in item && "text" in item) {
          kind = "user_message";
          title = "codex:history_entry";
          content = item.text;
        } else if (rawType === "event_msg" && payloadType === "agent_message") {
          kind = "assistant_message";
          title = "codex:agent_message";
          content = payload.message ?? payload.text ?? payload;
        } else if (rawType === "event_msg" && payloadType === "agent_reasoning") {
          kind = "assistant_message";
          title = "codex:agent_reasoning";
          content = payload.text ?? payload.message ?? payload;
        } else if (rawType === "event_msg" && payloadType === "token_count") {
          kind = "token";
          title = "codex:token_count";
          content = payload.info ?? payload;
        } else if (rawType === "response_item" && payloadType === "function_call") {
          kind = "tool_use";
          title = `codex:tool_call:${String(payload.name ?? "unknown")}`;
          content = payload.arguments ?? payload;
        } else if (rawType === "response_item" && payloadType === "function_call_output") {
          kind = "tool_result";
          title = "codex:tool_result";
          content = payload.output ?? payload;
        } else if (rawType === "response_item" && payloadType === "message") {
          const role = String(payload.role ?? "").toLowerCase();
          kind = role === "assistant" ? "assistant_message" : role === "user" ? "user_message" : "unknown";
          title = `codex:message:${role || "unknown"}`;
          content = payload.content ?? payload;
        } else if (rawType === "turn_context" || rawType === "session_meta") {
          kind = "system";
          title = `codex:${rawType}`;
          content = payload;
        } else if (rawType.includes("user")) {
          kind = "user_message";
        } else if (rawType.includes("assistant") || rawType.includes("agent")) {
          kind = "assistant_message";
        } else if (rawType.includes("token")) {
          kind = "token";
        } else if (rawType.includes("context") || rawType.includes("meta")) {
          kind = "system";
        }

        const event = makeRawEvent({
          client: this.client,
          sourcePath: file,
          ts: item.timestamp ?? item.ts,
          kind,
          title,
          content,
          metadata: {
            type: rawType || "unknown",
            payloadType: payloadType || undefined,
            cwd: currentCwd,
            projectRoot: currentCwd,
            sessionId,
            callId: payload.call_id,
            toolName: payload.name,
          },
        });

        if (withinSince(event.timestamp, options.sinceMs)) {
          events.push(event);
        }
      }
    }

    return events;
  }

  async doctor(paths: ClientPaths): Promise<DoctorCheck[]> {
    return [
      {
        ok: paths.files.length > 0,
        message: paths.files.length > 0 ? `found ${paths.files.length} Codex files` : "no Codex files found",
      },
    ];
  }
}
