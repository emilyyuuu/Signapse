-- Upgrades a database created from an earlier schema.sql. Safe to run more
-- than once, and a no-op on a database created from the current schema.sql.

-- Each line gets an id so the clinician can confirm one exact line.
-- Hypertables with columnstore can't add a column with a random default in one
-- step, so: add it empty, set the default for new rows, then backfill.
ALTER TABLE utterances ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE utterances ALTER COLUMN id SET DEFAULT gen_random_uuid();
UPDATE utterances SET id = gen_random_uuid() WHERE id IS NULL;
CREATE INDEX IF NOT EXISTS utterances_id_idx ON utterances (id);

-- Replace the 5-minute pain trend with 1-minute buckets and real-time aggregation.
DROP MATERIALIZED VIEW IF EXISTS pain_by_5min;

CREATE MATERIALIZED VIEW IF NOT EXISTS pain_by_minute
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
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => true);
