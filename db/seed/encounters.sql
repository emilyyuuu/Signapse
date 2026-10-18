-- Demo encounter used by the app's default links (DEMO_ENCOUNTER_ID in packages/shared).
INSERT INTO encounters (encounter_id, patient_ref, clinician_id)
VALUES ('00000000-0000-4000-8000-000000000001', 'PT-DEMO-0001', 'dr-demo')
ON CONFLICT (encounter_id) DO NOTHING;

-- Fake name for the demo visit.
UPDATE encounters SET patient_name = 'Jordan Demo'
WHERE encounter_id = '00000000-0000-4000-8000-000000000001' AND patient_name IS NULL;
