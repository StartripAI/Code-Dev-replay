import { DatabaseSync } from "node:sqlite";
import type { ClientPaths, DoctorCheck, RawEvent } from "../../shared-types/src";
import { readJson, makeRawEvent, withinSince, guardPath } from "./utils";
import type { Connector, ScanOptions } from "./types";

function uriToPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("file://")) return value;
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

export class VSCodeConnector implements Connector {
  readonly client = "vscode" as const;

  async scan(paths: ClientPaths, options: ScanOptions): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    for (const file of paths.files) {
      if (file.endsWith("entries.json")) {
        guardPath(file, paths.roots, options.audit, "read");
        const json = readJson(file) as {
          resource?: string;
          entries?: Array<{ id?: string; source?: string; timestamp?: number }>;
        };
        const resourcePath = uriToPath(json.resource);
        for (const entry of json.entries ?? []) {
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: entry.timestamp,
            kind: "history_entry",
            title: `vscode:history:${entry.source ?? "unknown"}`,
            content: entry,
            metadata: {
              entryId: entry.id,
              resource: json.resource,
              projectRoot: resourcePath ? resourcePath.split("/").slice(0, -1).join("/") : undefined,
            },
          });
          if (withinSince(event.timestamp, options.sinceMs)) {
            events.push(event);
          }
        }
        continue;
      }

      if (file.endsWith("workspace.json")) {
        guardPath(file, paths.roots, options.audit, "read");
        const json = readJson(file) as { folder?: string; folders?: Array<{ uri?: string }> };
        const roots = [
          ...(json.folder ? [json.folder] : []),
          ...(json.folders ?? []).map((x) => x.uri).filter(Boolean) as string[],
        ];
        for (const root of roots) {
          const event = makeRawEvent({
            client: this.client,
            sourcePath: file,
            ts: Date.now(),
            kind: "system",
            title: "vscode:workspace",
            content: root,
            metadata: {
              workspace: root,
              projectRoot: uriToPath(root),
            },
          });
          if (withinSince(event.timestamp, options.sinceMs)) {
            events.push(event);
          }
        }
        continue;
      }

      if (file.endsWith("state.vscdb")) {
        guardPath(file, paths.roots, options.audit, "sqlite");
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          const stmt = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' LIMIT 2000");
          const rows = stmt.all() as Array<{ key: string; value?: string }>;
          for (const row of rows) {
            const event = makeRawEvent({
              client: this.client,
              sourcePath: file,
              ts: Date.now(),
              kind: "system",
              title: "vscode:chat-key",
              content: row.value ?? row.key,
              metadata: { key: row.key, projectRoot: undefined },
            });
            if (withinSince(event.timestamp, options.sinceMs)) {
              events.push(event);
            }
          }

          const recentStmt = db.prepare(
            "SELECT key, value FROM ItemTable WHERE key='history.recentlyOpenedPathsList' LIMIT 1",
          );
          const recentRows = recentStmt.all() as Array<{ key: string; value: string }>;
          for (const row of recentRows) {
            try {
              const parsed = JSON.parse(row.value) as {
                entries?: Array<{ folderUri?: string; folderPath?: string; workspace?: { configPath?: string } }>;
              };
              for (const item of parsed.entries ?? []) {
                const root = item.folderPath ?? item.folderUri ?? item.workspace?.configPath;
                const event = makeRawEvent({
                  client: this.client,
                  sourcePath: file,
                  ts: Date.now(),
                  kind: "history_entry",
                  title: "vscode:recent_path",
                  content: root ?? item,
                  metadata: {
                    projectRoot: uriToPath(root),
                  },
                });
                if (withinSince(event.timestamp, options.sinceMs)) {
                  events.push(event);
                }
              }
            } catch {
              // Ignore malformed recent-path blob.
            }
          }
        } catch {
          // Ignore unsupported sqlite structure.
        } finally {
          db.close();
        }
      }
    }

    return events;
  }

  async doctor(paths: ClientPaths): Promise<DoctorCheck[]> {
    return [
      {
        ok: paths.files.length > 0,
        message: paths.files.length > 0 ? `found ${paths.files.length} VSCode files` : "no VSCode files found",
      },
    ];
  }
}
