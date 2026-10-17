import pg from "pg";
import {
  DEMO_ENCOUNTER_ID,
  type Encounter,
  type PainReading,
  type StoredPainReading,
  type StoredUtterance,
  type UtteranceEvent,
} from "@synapse/shared";

export interface Store {
  kind: "tiger" | "memory";
  getEncounter(id: string): Promise<Encounter | null>;
  createEncounter(patientRef: string, clinicianId: string): Promise<Encounter>;
  listUtterances(encounterId: string): Promise<StoredUtterance[]>;
  listPain(encounterId: string): Promise<StoredPainReading[]>;
  insertUtterance(u: UtteranceEvent): Promise<StoredUtterance>;
  insertPain(p: PainReading): Promise<StoredPainReading>;
}

// Tiger Cloud when DATABASE_URL is set, otherwise an in-memory store so the
// app runs locally (and in a pinch, on stage) without a database.
export function createStore(databaseUrl: string | undefined): Store {
  return databaseUrl ? tigerStore(databaseUrl) : memoryStore();
}

function tigerStore(connectionString: string): Store {
  const pool = new pg.Pool({ connectionString, max: 5 });

  const toEncounter = (r: any): Encounter => ({
    encounterId: r.encounter_id,
    patientRef: r.patient_ref,
    clinicianId: r.clinician_id,
    signLanguage: r.sign_language,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString(),
  });

  const toUtterance = (r: any): StoredUtterance => ({
    ts: r.ts.toISOString(),
    encounterId: r.encounter_id,
    speaker: r.speaker,
    kind: r.kind,
    gloss: r.gloss ?? undefined,
    nmm: r.nmm ?? undefined,
    grammarFlag: r.grammar_flag ?? undefined,
    sentence: r.sentence,
    plainText: r.plain_text ?? undefined,
    confidence: r.confidence ?? undefined,
    verifiedBy: r.verified_by ?? undefined,
    verifiedAt: r.verified_at?.toISOString(),
  });

  const toPain = (r: any): StoredPainReading => ({
    ts: r.ts.toISOString(),
    encounterId: r.encounter_id,
    zone: r.zone,
    severity: r.severity,
    source: r.source,
  });

  return {
    kind: "tiger",
    async getEncounter(id) {
      const { rows } = await pool.query("SELECT * FROM encounters WHERE encounter_id = $1", [id]);
      return rows[0] ? toEncounter(rows[0]) : null;
    },
    async createEncounter(patientRef, clinicianId) {
      const { rows } = await pool.query(
        "INSERT INTO encounters (patient_ref, clinician_id) VALUES ($1, $2) RETURNING *",
        [patientRef, clinicianId],
      );
      return toEncounter(rows[0]);
    },
    async listUtterances(encounterId) {
      const { rows } = await pool.query(
        "SELECT * FROM utterances WHERE encounter_id = $1 ORDER BY ts",
        [encounterId],
      );
      return rows.map(toUtterance);
    },
    async listPain(encounterId) {
      const { rows } = await pool.query(
        "SELECT * FROM pain_readings WHERE encounter_id = $1 ORDER BY ts",
        [encounterId],
      );
      return rows.map(toPain);
    },
    async insertUtterance(u) {
      const { rows } = await pool.query(
        `INSERT INTO utterances
           (encounter_id, speaker, kind, gloss, nmm, grammar_flag, sentence, plain_text, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          u.encounterId,
          u.speaker,
          u.kind,
          u.gloss ?? null,
          u.nmm ? JSON.stringify(u.nmm) : null,
          u.grammarFlag ?? null,
          u.sentence,
          u.plainText ?? null,
          u.confidence ?? null,
        ],
      );
      return toUtterance(rows[0]);
    },
    async insertPain(p) {
      const { rows } = await pool.query(
        `INSERT INTO pain_readings (encounter_id, zone, severity, source)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [p.encounterId, p.zone, p.severity, p.source],
      );
      return toPain(rows[0]);
    },
  };
}

function memoryStore(): Store {
  const encounters = new Map<string, Encounter>([
    [
      DEMO_ENCOUNTER_ID,
      {
        encounterId: DEMO_ENCOUNTER_ID,
        patientRef: "PT-DEMO-0001",
        clinicianId: "dr-demo",
        signLanguage: "ASL",
        startedAt: new Date().toISOString(),
      },
    ],
  ]);
  const utterances: StoredUtterance[] = [];
  const pain: StoredPainReading[] = [];

  return {
    kind: "memory",
    async getEncounter(id) {
      return encounters.get(id) ?? null;
    },
    async createEncounter(patientRef, clinicianId) {
      const e: Encounter = {
        encounterId: crypto.randomUUID(),
        patientRef,
        clinicianId,
        signLanguage: "ASL",
        startedAt: new Date().toISOString(),
      };
      encounters.set(e.encounterId, e);
      return e;
    },
    async listUtterances(encounterId) {
      return utterances.filter((u) => u.encounterId === encounterId);
    },
    async listPain(encounterId) {
      return pain.filter((p) => p.encounterId === encounterId);
    },
    async insertUtterance(u) {
      const row = { ...u, ts: new Date().toISOString() };
      utterances.push(row);
      return row;
    },
    async insertPain(p) {
      const row = { ...p, ts: new Date().toISOString() };
      pain.push(row);
      return row;
    },
  };
}
