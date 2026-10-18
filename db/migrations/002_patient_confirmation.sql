-- The patient checks what they signed before it is sent. Safe to run more than once.

-- How a signed line was confirmed: {"action":"sent|edited|auto_sent","redos":0,"original":{...}}.
-- Nullable with no default, which a columnstore hypertable accepts in one step.
ALTER TABLE utterances ADD COLUMN IF NOT EXISTS patient_confirmation jsonb;

-- Every action the patient took on a draft, including the ones that never reach the
-- doctor (redone). Holds sign labels only, never the sentences or any name.
CREATE TABLE IF NOT EXISTS patient_actions (
  ts            timestamptz NOT NULL DEFAULT now(),
  encounter_id  uuid NOT NULL REFERENCES encounters,
  draft_id      uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('sent','edited','auto_sent','redone')),
  urgent        boolean NOT NULL DEFAULT false,
  detail        jsonb                      -- e.g. {"gloss":["PAIN","CHEST"],"grammarFlag":"question"}
) WITH (tsdb.hypertable, tsdb.segmentby = 'encounter_id');
