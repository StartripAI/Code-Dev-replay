import type { ClientKind, ClientPaths, DoctorCheck, PathAccessAudit, RawEvent } from "../../shared-types/src";

export interface ScanOptions {
  sinceMs?: number;
  audit: PathAccessAudit;
}

export interface Connector {
  readonly client: ClientKind;
  scan(paths: ClientPaths, options: ScanOptions): Promise<RawEvent[]>;
  doctor(paths: ClientPaths, audit: PathAccessAudit): Promise<DoctorCheck[]>;
}
