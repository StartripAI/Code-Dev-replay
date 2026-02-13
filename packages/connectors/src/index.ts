import type { ClientKind } from "../../shared-types/src";
import { AntigravityConnector } from "./antigravity";
import { ClaudeConnector } from "./claude";
import { CodexConnector } from "./codex";
import { CursorConnector } from "./cursor";
import { OpenCodeConnector } from "./opencode";
import type { Connector } from "./types";
import { VSCodeConnector } from "./vscode";

const CONNECTORS: Record<ClientKind, Connector> = {
  claude: new ClaudeConnector(),
  codex: new CodexConnector(),
  cursor: new CursorConnector(),
  vscode: new VSCodeConnector(),
  antigravity: new AntigravityConnector(),
  opencode: new OpenCodeConnector(),
};

export function getConnector(client: ClientKind): Connector {
  return CONNECTORS[client];
}

export * from "./types";
