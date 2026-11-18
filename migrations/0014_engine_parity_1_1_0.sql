-- ARTEMIS AI — migration 0014: register rule engine 1.1.0 (Python/TypeScript parity).
-- Additive: new rows in model_versions; the default flag moves from 1.0.0 to 1.1.0.
-- Analyses already stored keep pointing to the version that produced them.
INSERT INTO "model_versions" ("engine_family", "version", "description", "dataset_type", "dataset_description", "metrics", "metrics_warning", "artifact_sha256", "is_experimental", "is_default") VALUES
  ('regras-python', '1.1.0-rules', 'Motor de regras transparente (FastAPI). Faixas contínuas de vento e chuva; explicação dos fatores soma exatamente a pontuação. Paridade exata com ts-1.1.0 (tests/unit/engine-parity.test.ts).',
   'nao-se-aplica', 'Regras determinísticas; sem treinamento.', NULL,
   'Limiares ainda não calibrados com incêndios reais.', NULL, false, false),
  ('regras-typescript', 'ts-1.1.0', 'Motor de regras transparente (TypeScript, shared/risk-engine.ts), fallback do motor Python. Corrige a divergência da ts-1.0.0 (foco a 5–50 km e histórico).',
   'nao-se-aplica', 'Regras determinísticas; sem treinamento.', NULL,
   'Limiares ainda não calibrados com incêndios reais.', NULL, false, false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "model_versions" SET "is_default" = false WHERE "engine_family" = 'regras-python' AND "version" = '1.0.0-rules';
--> statement-breakpoint
UPDATE "model_versions" SET "is_default" = true WHERE "engine_family" = 'regras-python' AND "version" = '1.1.0-rules';
