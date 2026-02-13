import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AnalysisInsights,
  ActionChain,
  ClientKind,
  EvidenceConflict,
  EvidenceItem,
  ExportPayload,
  GenerationResult,
  MajorEvent,
  PathAccessAudit,
  PromptPreview,
  RawEvent,
  ReplaySegment,
  RunContext,
  RunOutput,
  TimelineEvent,
} from "../../shared-types/src";

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class WDYDStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        client TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        selected_by TEXT NOT NULL,
        since_ms INTEGER,
        data_roots TEXT NOT NULL,
        query_json TEXT,
        project_scope_json TEXT,
        analysis_insights_json TEXT,
        prompt_preview_json TEXT,
        generation_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS raw_events (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS timeline_events (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS major_events (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS replay_segments (
        run_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS action_chains (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS evidence_items (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS evidence_conflicts (
        run_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      CREATE TABLE IF NOT EXISTS path_audit (
        run_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, idx)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_client_ended ON runs(client, ended_at DESC);
      CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline_events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_major_ts ON major_events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_ts ON evidence_items(ts DESC);
    `);

    this.ensureColumn("runs", "query_json", "TEXT");
    this.ensureColumn("runs", "project_scope_json", "TEXT");
    this.ensureColumn("runs", "analysis_insights_json", "TEXT");
    this.ensureColumn("runs", "prompt_preview_json", "TEXT");
    this.ensureColumn("runs", "generation_json", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  saveRun(output: RunOutput): void {
    const run = output.context;

    const insertRun = this.db.prepare(`
      INSERT OR REPLACE INTO runs
      (run_id, client, started_at, ended_at, selected_by, since_ms, data_roots, query_json, project_scope_json, analysis_insights_json, prompt_preview_json, generation_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRun.run(
      run.runId,
      run.client,
      run.startedAt,
      run.endedAt,
      run.selectedBy,
      run.sinceMs ?? null,
      toJson(run.dataRoots),
      output.query ? toJson(output.query) : null,
      output.projectScope ? toJson(output.projectScope) : null,
      output.insights ? toJson(output.insights) : null,
      output.promptPreview ? toJson(output.promptPreview) : null,
      output.generation ? toJson(output.generation) : null,
      Date.now(),
    );

    const insertRaw = this.db.prepare(`INSERT OR REPLACE INTO raw_events (run_id, id, payload) VALUES (?, ?, ?)`);
    for (const event of output.rawEvents) {
      insertRaw.run(run.runId, event.id, toJson(event));
    }

    const insertTimeline = this.db.prepare(
      `INSERT OR REPLACE INTO timeline_events (run_id, id, ts, payload) VALUES (?, ?, ?, ?)`,
    );
    for (const event of output.timeline) {
      insertTimeline.run(run.runId, event.id, event.ts, toJson(event));
    }

    const insertMajor = this.db.prepare(
      `INSERT OR REPLACE INTO major_events (run_id, id, ts, payload) VALUES (?, ?, ?, ?)`,
    );
    for (const major of output.majorEvents) {
      insertMajor.run(run.runId, major.id, major.ts, toJson(major));
    }

    const insertReplay = this.db.prepare(
      `INSERT OR REPLACE INTO replay_segments (run_id, event_id, payload) VALUES (?, ?, ?)`,
    );
    for (const seg of output.replay) {
      insertReplay.run(run.runId, seg.eventId, toJson(seg));
    }

    const insertActionChain = this.db.prepare(
      `INSERT OR REPLACE INTO action_chains (run_id, id, payload) VALUES (?, ?, ?)`,
    );
    for (const chain of output.actionChains) {
      insertActionChain.run(run.runId, chain.id, toJson(chain));
    }

    const insertEvidence = this.db.prepare(
      `INSERT OR REPLACE INTO evidence_items (run_id, id, ts, payload) VALUES (?, ?, ?, ?)`,
    );
    for (const item of output.evidence) {
      insertEvidence.run(run.runId, item.id, item.ts, toJson(item));
    }

    const insertConflict = this.db.prepare(
      `INSERT OR REPLACE INTO evidence_conflicts (run_id, id, payload) VALUES (?, ?, ?)`,
    );
    for (const conflict of output.conflicts) {
      insertConflict.run(run.runId, conflict.id, toJson(conflict));
    }

    const insertAudit = this.db.prepare(`INSERT OR REPLACE INTO path_audit (run_id, idx, payload) VALUES (?, ?, ?)`);
    output.audit.records.forEach((record, idx) => {
      insertAudit.run(run.runId, idx, toJson(record));
    });
  }

  latestRunContext(client: ClientKind): RunContext | null {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE client = ? ORDER BY created_at DESC LIMIT 1`)
      .get(client) as
      | {
          run_id: string;
          client: string;
          started_at: number;
          ended_at: number;
          selected_by: RunContext["selectedBy"];
          since_ms: number | null;
          data_roots: string;
          query_json: string | null;
          project_scope_json: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      runId: row.run_id,
      client: row.client as ClientKind,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      selectedBy: row.selected_by,
      sinceMs: row.since_ms ?? undefined,
      dataRoots: fromJson<string[]>(row.data_roots),
      query: row.query_json ? fromJson(row.query_json) : undefined,
      projectScope: row.project_scope_json ? fromJson(row.project_scope_json) : undefined,
    };
  }

  loadLatest(client: ClientKind): ExportPayload | null {
    const context = this.latestRunContext(client);
    if (!context) return null;

    const timeline = this.db
      .prepare(`SELECT payload FROM timeline_events WHERE run_id = ? ORDER BY ts ASC`)
      .all(context.runId) as Array<{ payload: string }>;

    const major = this.db
      .prepare(`SELECT payload FROM major_events WHERE run_id = ? ORDER BY ts ASC`)
      .all(context.runId) as Array<{ payload: string }>;

    const replay = this.db
      .prepare(`SELECT payload FROM replay_segments WHERE run_id = ?`)
      .all(context.runId) as Array<{ payload: string }>;

    const actionChains = this.db
      .prepare(`SELECT payload FROM action_chains WHERE run_id = ?`)
      .all(context.runId) as Array<{ payload: string }>;

    const evidence = this.db
      .prepare(`SELECT payload FROM evidence_items WHERE run_id = ? ORDER BY ts ASC`)
      .all(context.runId) as Array<{ payload: string }>;

    const conflicts = this.db
      .prepare(`SELECT payload FROM evidence_conflicts WHERE run_id = ?`)
      .all(context.runId) as Array<{ payload: string }>;

    const runRow = this.db
      .prepare(
        `SELECT prompt_preview_json, generation_json, query_json, project_scope_json, analysis_insights_json FROM runs WHERE run_id = ? LIMIT 1`,
      )
      .get(context.runId) as
      | {
          prompt_preview_json: string | null;
          generation_json: string | null;
          query_json: string | null;
          project_scope_json: string | null;
          analysis_insights_json: string | null;
        }
      | undefined;

    const auditRows = this.db
      .prepare(`SELECT payload FROM path_audit WHERE run_id = ? ORDER BY idx ASC`)
      .all(context.runId) as Array<{ payload: string }>;

    return {
      context,
      query: runRow?.query_json ? fromJson(runRow.query_json) : undefined,
      projectScope: runRow?.project_scope_json ? fromJson(runRow.project_scope_json) : undefined,
      insights: runRow?.analysis_insights_json ? fromJson<AnalysisInsights>(runRow.analysis_insights_json) : undefined,
      timeline: timeline.map((row) => fromJson<TimelineEvent>(row.payload)),
      majorEvents: major.map((row) => fromJson<MajorEvent>(row.payload)),
      actionChains: actionChains.map((row) => fromJson<ActionChain>(row.payload)),
      evidence: evidence.map((row) => fromJson<EvidenceItem>(row.payload)),
      conflicts: conflicts.map((row) => fromJson<EvidenceConflict>(row.payload)),
      promptPreview: runRow?.prompt_preview_json ? fromJson<PromptPreview>(runRow.prompt_preview_json) : undefined,
      generation: runRow?.generation_json ? fromJson<GenerationResult>(runRow.generation_json) : undefined,
      replay: replay.map((row) => fromJson<ReplaySegment>(row.payload)),
      audit: {
        client,
        records: auditRows.map((row) => fromJson<PathAccessAudit["records"][number]>(row.payload)),
      },
    };
  }

  close(): void {
    this.db.close();
  }
}
