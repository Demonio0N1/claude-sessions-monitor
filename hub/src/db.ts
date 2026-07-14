import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { MachineInfo } from './types.js';

const db = new Database(path.join(DATA_DIR, 'csm.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    os TEXT NOT NULL,
    arch TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    last_seen INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(machine_id, session_id, ts DESC);
`);

const upsertMachineStmt = db.prepare(`
  INSERT INTO machines (id, name, os, arch, version, last_seen)
  VALUES (@id, @name, @os, @arch, @version, @lastSeen)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, os=excluded.os, arch=excluded.arch,
    version=excluded.version, last_seen=excluded.last_seen
`);

export function upsertMachine(info: MachineInfo, lastSeen: number): void {
  upsertMachineStmt.run({ ...info, lastSeen });
}

export function touchMachine(id: string, lastSeen: number): void {
  db.prepare('UPDATE machines SET last_seen=? WHERE id=?').run(lastSeen, id);
}

export interface PersistedMachine {
  info: MachineInfo;
  lastSeen: number;
}

export function listMachines(): PersistedMachine[] {
  const rows = db.prepare('SELECT * FROM machines').all() as {
    id: string; name: string; os: string; arch: string; version: string; last_seen: number;
  }[];
  return rows.map((r) => ({
    info: { id: r.id, name: r.name, os: r.os, arch: r.arch, version: r.version },
    lastSeen: r.last_seen,
  }));
}

export function deleteMachine(id: string): void {
  db.prepare('DELETE FROM events WHERE machine_id=?').run(id);
  db.prepare('DELETE FROM machines WHERE id=?').run(id);
}

const insertEventStmt = db.prepare(`
  INSERT INTO events (machine_id, session_id, cwd, kind, ts, detail)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function recordEvent(
  machineId: string, sessionId: string, cwd: string, kind: string, ts: number, detail: string,
): void {
  insertEventStmt.run(machineId, sessionId, cwd, kind, ts, detail);
}

export interface EventRow {
  kind: string;
  ts: number;
  detail: string;
}

export function listEvents(machineId: string, sessionId: string, limit = 100): EventRow[] {
  return db
    .prepare(
      'SELECT kind, ts, detail FROM events WHERE machine_id=? AND session_id=? ORDER BY ts DESC LIMIT ?',
    )
    .all(machineId, sessionId, limit) as EventRow[];
}
