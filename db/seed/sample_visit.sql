-- A finished sample visit spread over 40 minutes, so the review screen and the
-- pain-over-time chart have something realistic to show. Open it with
-- /review?e=00000000-0000-4000-8000-000000000002. Inserted once; re-running is a no-op.
INSERT INTO encounters (encounter_id, patient_ref, clinician_id, started_at)
VALUES ('00000000-0000-4000-8000-000000000002', 'PT-SAMPLE-0002', 'dr-sample', now() - INTERVAL '45 minutes')
ON CONFLICT (encounter_id) DO NOTHING;

-- It's a finished visit, so it doesn't show up as open on the start screen.
UPDATE encounters SET ended_at = now() - INTERVAL '1 minute'
WHERE encounter_id = '00000000-0000-4000-8000-000000000002' AND ended_at IS NULL;

INSERT INTO utterances (ts, encounter_id, speaker, kind, gloss, nmm, grammar_flag, sentence, confidence, verified_by, verified_at)
SELECT now() - v.ago, '00000000-0000-4000-8000-000000000002', 'patient', 'sign', v.gloss, v.nmm::jsonb, v.flag, v.sentence, v.conf, v.vby,
       CASE WHEN v.vby IS NULL THEN NULL ELSE now() - v.ago + INTERVAL '1 minute' END
FROM (VALUES
  (INTERVAL '44 minutes', ARRAY['PAIN','CHEST'], '{"browUp":0.02,"headYawFlips":0}', 'statement',
   'The patient reports chest pain.', 0.93, NULL),
  (INTERVAL '42 minutes', ARRAY['BREATHE','HARD'], '{"headYawFlips":3}', 'negation',
   'The patient denies difficulty breathing.', 0.9, 'dr-sample'),
  (INTERVAL '30 minutes', ARRAY['PAIN','HEAD'], '{"browDown":0.12,"eyeSquint":0.2,"furrowHoldMs":420}', 'intensified',
   'The patient reports a significant headache.', 0.86, NULL),
  (INTERVAL '12 minutes', ARRAY['PAIN','CHEST'], '{"browUp":0.41,"browHoldMs":900}', 'question',
   'The patient is asking whether the chest pain is serious.', 0.84, NULL)
) AS v(ago, gloss, nmm, flag, sentence, conf, vby)
WHERE NOT EXISTS (SELECT 1 FROM utterances WHERE encounter_id = '00000000-0000-4000-8000-000000000002');

INSERT INTO pain_readings (ts, encounter_id, zone, severity, source)
SELECT now() - v.ago, '00000000-0000-4000-8000-000000000002', v.zone, v.sev, 'tap'
FROM (VALUES
  (INTERVAL '43 minutes', 'chest', 4), (INTERVAL '35 minutes', 'chest', 5), (INTERVAL '28 minutes', 'chest', 6),
  (INTERVAL '20 minutes', 'chest', 7), (INTERVAL '10 minutes', 'chest', 8), (INTERVAL '3 minutes', 'chest', 8),
  (INTERVAL '30 minutes', 'head', 6), (INTERVAL '18 minutes', 'head', 4), (INTERVAL '5 minutes', 'head', 3),
  (INTERVAL '25 minutes', 'lowerback', 3), (INTERVAL '8 minutes', 'lowerback', 3)
) AS v(ago, zone, sev)
WHERE NOT EXISTS (SELECT 1 FROM pain_readings WHERE encounter_id = '00000000-0000-4000-8000-000000000002');
