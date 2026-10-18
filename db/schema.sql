-- Signapse conversation log for Tiger Cloud (Postgres + TimescaleDB)
-- Stores text and structured events only. Video and landmarks never leave the device.

CREATE TABLE encounters (
  encounter_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_ref   text NOT NULL,            -- internal token shown on screens, e.g. PT-7K3Q
  patient_name  text,                     -- typed at check-in; never sent to Gemini or logged; fake names in demos
  clinician_id  text NOT NULL,
  sign_language text NOT NULL DEFAULT 'ASL',
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

-- Every signed phrase, clinician reply and patient answer.
CREATE TABLE utterances (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),  -- lets the clinician confirm one exact line
  ts            timestamptz NOT NULL DEFAULT now(),
  encounter_id  uuid NOT NULL REFERENCES encounters,
  speaker       text NOT NULL CHECK (speaker IN ('patient','clinician')),
  kind          text NOT NULL CHECK (kind IN ('sign','reply','answer')),
  gloss         text[],                   -- raw signs, e.g. {PAIN,HEAD,THROB}
  nmm           jsonb,                    -- {"browInnerUp":0.82,"headYaw":"..."}
  grammar_flag  text,                     -- statement | question | negation | intensified
  sentence      text NOT NULL,            -- clinical sentence shown and spoken
  plain_text    text,                     -- plain-language version for the patient
  confidence    real,
  verified_by   text,                     -- clinician who confirmed the meaning
  verified_at   timestamptz,
  patient_confirmation jsonb              -- how the patient confirmed it: sent / edited / auto_sent
) WITH (tsdb.hypertable, tsdb.segmentby = 'encounter_id');

-- Every action the patient took on a draft before it was sent, including redone ones.
-- Sign labels only, never sentences or names.
CREATE TABLE patient_actions (
  ts            timestamptz NOT NULL DEFAULT now(),
  encounter_id  uuid NOT NULL REFERENCES encounters,
  draft_id      uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('sent','edited','auto_sent','redone')),
  urgent        boolean NOT NULL DEFAULT false,
  detail        jsonb
) WITH (tsdb.hypertable, tsdb.segmentby = 'encounter_id');

-- Body-map taps and pointing gestures.
CREATE TABLE pain_readings (
  ts            timestamptz NOT NULL DEFAULT now(),
  encounter_id  uuid NOT NULL REFERENCES encounters,
  zone          text NOT NULL,            -- 'chest', 'lowerback', ...
  severity      smallint NOT NULL CHECK (severity BETWEEN 0 AND 10),
  source        text NOT NULL CHECK (source IN ('tap','pointing'))
) WITH (tsdb.hypertable, tsdb.segmentby = 'encounter_id');

CREATE INDEX utterances_id_idx ON utterances (id);

-- Pre-computed pain trend for the chart-review screen. One-minute buckets so a
-- short visit still draws a line; real-time aggregation (materialized_only =
-- false) includes readings from seconds ago that the policy hasn't refreshed yet.
CREATE MATERIALIZED VIEW pain_by_minute
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 minute', ts) AS bucket,
       encounter_id,
       zone,
       max(severity) AS peak
FROM pain_readings
GROUP BY 1, 2, 3;

SELECT add_continuous_aggregate_policy('pain_by_minute',
  start_offset      => INTERVAL '1 day',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- Chart review: the full conversation for one encounter, in order.
-- SELECT ts, speaker, sentence, grammar_flag, verified_by IS NOT NULL AS verified
-- FROM utterances WHERE encounter_id = $1 ORDER BY ts;
