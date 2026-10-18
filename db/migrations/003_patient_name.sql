-- The patient's name, typed at check-in on the patient station. Safe to run more than once.
-- It lives only in this column. The key stays encounters.encounter_id (an internal uuid),
-- the name is never in utterances, never sent to Gemini and never written to a log.
-- Demo and test data use fake names only. This is not a HIPAA-compliant store.
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS patient_name text;
