-- ARTEMIS AI — migration 0007: AI traceability.
-- model_versions: which engine/model produced each analysis, on which data.
-- risk_analysis_sources: which data sources fed each analysis (queryable).
-- Additive; existing JSON columns on risk_analyses are kept for compatibility.

CREATE TABLE IF NOT EXISTS "model_versions" (
  "id" serial PRIMARY KEY,
  "engine_family" text NOT NULL,          -- regras-python | regras-typescript | rf-sintetico
  "version" text NOT NULL,
  "description" text NOT NULL,
  "dataset_type" text NOT NULL,           -- nao-se-aplica | sintetico | real
  "dataset_description" text,
  "metrics" json,
  "metrics_warning" text,
  "artifact_sha256" text,
  "is_experimental" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "model_versions_dataset_ck" CHECK ("dataset_type" IN ('nao-se-aplica', 'sintetico', 'real'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_versions_family_version_uq" ON "model_versions" ("engine_family", "version");
--> statement-breakpoint
INSERT INTO "model_versions" ("engine_family", "version", "description", "dataset_type", "dataset_description", "metrics", "metrics_warning", "artifact_sha256", "is_experimental", "is_default") VALUES
  ('regras-python', '1.0.0-rules', 'Motor de regras transparente (FastAPI). Limiares documentados em python_service/risk_model.py.',
   'nao-se-aplica', 'Regras determinísticas; sem treinamento.', NULL,
   'Limiares ainda não calibrados com incêndios reais.', NULL, false, true),
  ('regras-typescript', 'ts-1.0.0', 'Motor de regras transparente (TypeScript, shared/risk-engine.ts). Espelho do motor Python, usado como fallback.',
   'nao-se-aplica', 'Regras determinísticas; sem treinamento.', NULL,
   'Limiares ainda não calibrados com incêndios reais.', NULL, false, false),
  ('rf-sintetico', '1.0.0-sklearn-rf', 'RandomForestClassifier (Scikit-learn), 100 árvores, profundidade 10. Ativado só com RISK_ENGINE_MODE=ml-experimental.',
   'sintetico', '2000 amostras sintéticas (1600 treino / 400 teste) rotuladas pelo próprio motor de regras; 500 por classe. Treinado em 2026-07-20.',
   '{"accuracy": 1.0, "f1_macro": 1.0, "fonte": "python_service/results/metrics.json"}',
   'Métricas sobre dados sintéticos rotulados pelo motor de regras (viés circular): medem só a reprodução das regras, NÃO a previsão de incêndios. O README e o dossiê TRL 4 citam 84,25% de acurácia, valor que diverge do metrics.json atual (100%); nenhum dos dois é evidência de desempenho operacional.',
   'e949aac2eefb99bb9bfa3a2a06018adba2be5a6249d9276fad0a77a5a8dcf47a', true, false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "model_version_id" integer REFERENCES "model_versions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_analyses_model_version_idx" ON "risk_analyses" ("model_version_id");
--> statement-breakpoint
-- Backfill from the engine type recorded on each analysis.
UPDATE "risk_analyses" r SET "model_version_id" = m.id FROM "model_versions" m
WHERE r.model_version_id IS NULL AND (
  (r.engine_type = 'transparent-rule-engine' AND m.engine_family = 'regras-python' AND m.version = '1.0.0-rules') OR
  (r.engine_type LIKE 'transparent-rule-engine-ts%' AND m.engine_family = 'regras-typescript' AND m.version = 'ts-1.0.0') OR
  (r.engine_type = 'supervised-ml' AND m.engine_family = 'rf-sintetico' AND m.version = '1.0.0-sklearn-rf')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "risk_analysis_sources" (
  "id" serial PRIMARY KEY,
  "analysis_id" integer NOT NULL REFERENCES "risk_analyses"("id") ON DELETE CASCADE,
  "source_key" text NOT NULL,             -- manual | open-meteo | fire_occurrences | inpe-queimadas
  "data_source_id" integer REFERENCES "data_sources"("id") ON DELETE SET NULL,
  "fields" text[] NOT NULL DEFAULT '{}',  -- engine inputs fed by this source
  "reference_at" timestamptz,
  "record_count" integer,
  "detail" json
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_analysis_sources_analysis_idx" ON "risk_analysis_sources" ("analysis_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_analysis_sources_source_idx" ON "risk_analysis_sources" ("source_key", "reference_at");
--> statement-breakpoint
-- Backfill from the JSON already stored on each analysis.
INSERT INTO "risk_analysis_sources" ("analysis_id", "source_key", "data_source_id", "reference_at", "detail")
SELECT r.id, s->>'key', ds.id, NULLIF(s->>'referenceAt', '')::timestamptz, s
FROM "risk_analyses" r
CROSS JOIN LATERAL json_array_elements(coalesce(r.data_sources, '[]'::json)) s
LEFT JOIN "data_sources" ds ON ds.key = s->>'key'
WHERE NOT EXISTS (SELECT 1 FROM "risk_analysis_sources" x WHERE x.analysis_id = r.id);
