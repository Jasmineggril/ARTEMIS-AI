import { pgTable, text, serial, integer, boolean, timestamp, doublePrecision, json, uniqueIndex, index, date, smallint, char, bigserial } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Existing tables (preserved) ─────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").default(""),
  lastName: text("last_name").default(""),
  role: text("role").default("user"),
  bio: text("bio").default(""),
  avatar: text("avatar").default(""),
  propertyProfile: json("property_profile"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sensors = pgTable("sensors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  location: text("location").notNull(),
  status: text("status").notNull().default("active"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  lastPing: timestamp("last_ping", { withTimezone: true }).defaultNow(),
});

export const readings = pgTable("readings", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id").notNull(),
  value: doublePrecision("value").notNull(),
  unit: text("unit").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull(),
  isResolved: boolean("is_resolved").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // ARTEMIS AI (migration 0002)
  organizationId: integer("organization_id"),
  areaId: integer("area_id"),
  riskAnalysisId: integer("risk_analysis_id"),
  status: text("status").notNull().default("novo"), // novo | reconhecido | em_acompanhamento | resolvido | descartado
  reason: text("reason"),
  dataSource: text("data_source"),
  dataReferenceAt: timestamp("data_reference_at", { withTimezone: true }),
  assignedTo: integer("assigned_to"),
  recommendations: json("recommendations"),
  dedupKey: text("dedup_key"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  isDemo: boolean("is_demo").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  // migration 0012
  kind: text("kind").notNull().default("risco"), // risco | foco_proximo
  evidence: json("evidence"),
  // migration 0013: expert verdict (Proof of Value)
  evaluation: text("evaluation"), // pertinente | parcialmente_pertinente | nao_pertinente
  evaluationNote: text("evaluation_note"),
  evaluatedBy: integer("evaluated_by"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
});

export const weatherData = pgTable("weather_data", {
  id: serial("id").primaryKey(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  temperature: doublePrecision("temperature"),
  humidity: doublePrecision("humidity"),
  windSpeed: doublePrecision("wind_speed"),
  windDirection: text("wind_direction"),
  rainfall: doublePrecision("rainfall"),
  pressure: doublePrecision("pressure"),
  uvIndex: doublePrecision("uv_index"),
  condition: text("condition"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  // migration 0006: provenance and cache
  sourceKey: text("source_key").notNull().default("open-meteo"),
  kind: text("kind").notNull().default("atual"), // atual | previsao | historico | estacao
  observedAt: timestamp("observed_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  precipitation72h: doublePrecision("precipitation_72h"),
});

export const userStats = pgTable("user_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  points: integer("points").default(0),
  level: integer("level").default(1),
  denunciasCount: integer("denuncias_count").default(0),
  achievement: text("achievement").default("iniciante"),
  lastActivity: timestamp("last_activity", { withTimezone: true }).defaultNow(),
});

export const denuncias = pgTable("denuncias", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull(),
  categoria: text("categoria").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  municipio: text("municipio"),
  status: text("status").default("pendente"),
  pontosAtribuidos: integer("pontos_atribuidos").default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  badgeId: text("badge_id").notNull(),
  badgeName: text("badge_name").notNull(),
  badgeDesc: text("badge_desc").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).defaultNow(),
});

// ─── New tables for risk platform ────────────────────────────────────────────

/** Áreas produtivas monitoradas */
export const monitoredAreas = pgTable("monitored_areas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  operationType: text("operation_type").notNull(), // 'agroindústria', 'florestal', 'energia', 'mineração', 'logística', 'outro'
  municipality: text("municipality").notNull(),
  state: text("state").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  areaHectares: doublePrecision("area_hectares"),
  status: text("status").notNull().default("ativo"), // 'ativo', 'inativo', 'em análise'
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  // ARTEMIS AI (migration 0002)
  organizationId: integer("organization_id"),
  vegetationCategory: text("vegetation_category"),
  boundary: json("boundary"), // GeoJSON Polygon/MultiPolygon (validated server-side)
  notes: text("notes"),
  // migration 0012: provenance of values (informed by the user vs calculated from the polygon)
  boundaryAreaHa: doublePrecision("boundary_area_ha"),
  boundarySource: text("boundary_source"), // desenho | geojson | kml | kmz | shapefile
  areaHectaresSource: text("area_hectares_source"), // informada | calculada
  coordinatesSource: text("coordinates_source"), // informadas | centro_do_poligono
  hotspotAlertKm: doublePrecision("hotspot_alert_km").notNull().default(5),
});

/** Análises de risco executadas */
export const riskAnalyses = pgTable("risk_analyses", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id"),
  score: integer("score").notNull(),
  level: text("level").notNull(), // 'baixo' | 'moderado' | 'alto' | 'crítico'
  confidence: doublePrecision("confidence"),
  inputData: json("input_data"),
  factors: json("factors"),
  recommendations: json("recommendations"),
  isSimulated: boolean("is_simulated").default(true),
  calculationVersion: text("calculation_version").default("1.0.0"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // ARTEMIS AI (migration 0002)
  organizationId: integer("organization_id"),
  engineType: text("engine_type"),          // transparent-rule-engine | supervised-ml | ...-ts-fallback
  isExperimental: boolean("is_experimental").notNull().default(false),
  dataSources: json("data_sources"),        // [{ name, kind, referenceAt, url? }]
  dataQuality: json("data_quality"),        // { level, missingFields[], notes[] }
  limitations: json("limitations"),         // string[]
  areaSnapshot: json("area_snapshot"),      // area as it was at analysis time (migration 0004)
  modelVersionId: integer("model_version_id"), // migration 0007
  clientDurationMs: integer("client_duration_ms"), // migration 0013: time from opening the form to the result
  // migration 0017: expert verdict on the recommendations
  recommendationEvaluation: text("recommendation_evaluation"),
  recommendationEvaluationNote: text("recommendation_evaluation_note"),
  recommendationEvaluatedBy: integer("recommendation_evaluated_by"),
  recommendationEvaluatedAt: timestamp("recommendation_evaluated_at", { withTimezone: true }),
});

/** Fontes de dados disponíveis */
export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'estação climática', 'sensor IoT', 'API ambiental', 'base histórica', 'base geográfica', 'entrada manual', 'simulação'
  status: text("status").notNull().default("simulado"), // 'ativo', 'simulado', 'em integração', 'indisponível'
  isSimulated: boolean("is_simulated").default(true),
  lastUpdate: timestamp("last_update", { withTimezone: true }).defaultNow(),
  quality: doublePrecision("quality"), // 0–1
  description: text("description"),
  // migration 0006
  key: text("key"),
  url: text("url"),
  licence: text("licence"),
  accessMethod: text("access_method"),
  updateFrequency: text("update_frequency"),
  isOfficial: boolean("is_official").notNull().default(false),
  integrationStatus: text("integration_status"),
});

/** Lotes de importação de ocorrências históricas */
export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  sourceName: text("source_name").notNull().default(""),
  sourceType: text("source_type").notNull().default("arquivo importado"),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  warningRows: integer("warning_rows").notNull().default(0),
  invalidRows: integer("invalid_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow(),
  importedBy: integer("imported_by"),
  status: text("status").notNull().default("concluído"),
  notes: text("notes"),
  organizationId: integer("organization_id"),
  rejectionReasons: json("rejection_reasons"),
  visibility: text("visibility").notNull().default("privado"), // privado | publico (migration 0003)
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: integer("published_by"),
});

/** Ocorrências de incêndio importadas */
export const fireOccurrences = pgTable("fire_occurrences", {
  id: serial("id").primaryKey(),
  // NULL only for official public records (migration 0011, provenance CHECK).
  importBatchId: integer("import_batch_id"),
  occurrenceDate: text("occurrence_date"),
  occurrenceTime: text("occurrence_time"),
  municipality: text("municipality"),
  state: text("state"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  occurrenceType: text("occurrence_type"),
  occurrenceStatus: text("occurrence_status"),
  affectedArea: doublePrecision("affected_area"),
  cause: text("cause"),
  vegetationCondition: text("vegetation_condition"),
  notes: text("notes"),
  source: text("source"),
  sourceReference: text("source_reference"),
  validationStatus: text("validation_status").notNull().default("válido"),
  rawData: json("raw_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  organizationId: integer("organization_id"),
  // Generated by PostgreSQL from the original text columns (migration 0005).
  occurredOn: date("occurred_on", { mode: "string" }).generatedAlwaysAs(sql`CASE WHEN occurrence_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN make_date(substr(occurrence_date, 1, 4)::int, substr(occurrence_date, 6, 2)::int, substr(occurrence_date, 9, 2)::int) END`),
  occurredHour: smallint("occurred_hour").generatedAlwaysAs(sql`CASE WHEN occurrence_time ~ '^([01]?[0-9]|2[0-3])([:hH]|$)' THEN substring(occurrence_time from '^([0-9]{1,2})')::smallint END`),
  dedupKey: text("dedup_key").generatedAlwaysAs(sql`CASE WHEN occurrence_date IS NOT NULL THEN md5(occurrence_date || '|' || lower(btrim(coalesce(municipality, ''))) || '|' || upper(coalesce(state, '')) || '|' || coalesce(round(latitude::numeric, 3)::text, '') || '|' || coalesce(round(longitude::numeric, 3)::text, '') || '|' || lower(btrim(coalesce(occurrence_type, '')))) END`),
  municipalityIbgeCode: char("municipality_ibge_code", { length: 7 }),
  // Official public records (migration 0011): organization_id NULL, identified by source + external id.
  dataSourceId: integer("data_source_id"),
  externalId: text("external_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  sourceAvailable: boolean("source_available").notNull().default(true),
});

/** Official IBGE municipality list (migration 0005). */
export const municipalities = pgTable("municipalities", {
  ibgeCode: char("ibge_code", { length: 7 }).primaryKey(),
  name: text("name").notNull(),
  state: char("state", { length: 2 }).notNull(),
  nameNormalized: text("name_normalized").notNull(),
  source: text("source").notNull().default("IBGE — API de Localidades"),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Municipality = typeof municipalities.$inferSelect;

// ─── ARTEMIS AI: organizations, alert history, audit (migration 0002) ────────

export const ORG_ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;
export type OrgRole = typeof ORG_ROLES[number];

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("produtor"), // produtor | empresa | pesquisa | gestao_publica | outro
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const organizationMembers = pgTable("organization_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgUserUnique: uniqueIndex("organization_members_org_user_uq").on(t.organizationId, t.userId),
}));

export const ALERT_STATUSES = ["novo", "reconhecido", "em_acompanhamento", "resolvido", "descartado"] as const;
export type AlertStatus = typeof ALERT_STATUSES[number];

export const alertEvents = pgTable("alert_events", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ alertIdx: index("alert_events_alert_idx").on(t.alertId) }));

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: json("metadata"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Insert schemas ───────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, role: true });
export const insertSensorSchema = createInsertSchema(sensors).omit({ id: true, lastPing: true });
export const insertReadingSchema = createInsertSchema(readings).omit({ id: true, timestamp: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true, isResolved: true });
export const insertWeatherSchema = createInsertSchema(weatherData).omit({ id: true, timestamp: true });
export const insertUserStatsSchema = createInsertSchema(userStats).omit({ id: true, lastActivity: true });
export const insertDenunciaSchema = createInsertSchema(denuncias).omit({ id: true, createdAt: true, status: true, pontosAtribuidos: true });
export const insertAchievementSchema = createInsertSchema(achievements).omit({ id: true, earnedAt: true });

export const insertMonitoredAreaSchema = createInsertSchema(monitoredAreas).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRiskAnalysisSchema = createInsertSchema(riskAnalyses).omit({ id: true, createdAt: true });
export const insertDataSourceSchema = createInsertSchema(dataSources).omit({ id: true, lastUpdate: true });
export const insertImportBatchSchema = createInsertSchema(importBatches).omit({ id: true, importedAt: true });
export const insertFireOccurrenceSchema = createInsertSchema(fireOccurrences).omit({ id: true, createdAt: true });

// ─── Types ────────────────────────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Sensor = typeof sensors.$inferSelect;
export type InsertSensor = z.infer<typeof insertSensorSchema>;
export type Reading = typeof readings.$inferSelect;
export type InsertReading = z.infer<typeof insertReadingSchema>;
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type WeatherData = typeof weatherData.$inferSelect;
export type InsertWeatherData = z.infer<typeof insertWeatherSchema>;
export type UserStats = typeof userStats.$inferSelect;
export type InsertUserStats = z.infer<typeof insertUserStatsSchema>;
export type Denuncia = typeof denuncias.$inferSelect;
export type InsertDenuncia = z.infer<typeof insertDenunciaSchema>;
export type Achievement = typeof achievements.$inferSelect;
export type InsertAchievement = z.infer<typeof insertAchievementSchema>;
export type MonitoredArea = typeof monitoredAreas.$inferSelect;
export type InsertMonitoredArea = z.infer<typeof insertMonitoredAreaSchema>;
export type RiskAnalysis = typeof riskAnalyses.$inferSelect;
export type InsertRiskAnalysis = z.infer<typeof insertRiskAnalysisSchema>;
export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type FireOccurrence = typeof fireOccurrences.$inferSelect;
export type InsertFireOccurrence = z.infer<typeof insertFireOccurrenceSchema>;

// ─── Environmental sources (migration 0006) ──────────────────────────────────

export const sourceSyncRuns = pgTable("source_sync_runs", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("em_execucao"), // em_execucao | sucesso | falha
  params: json("params"),
  recordsRead: integer("records_read").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  rejectionReasons: json("rejection_reasons"),
  error: text("error"),
  // migration 0011
  trigger: text("trigger"), // cli | agendado | manual
  triggeredBy: integer("triggered_by"),
  pagesRead: integer("pages_read").notNull().default(0),
  recordsUnchanged: integer("records_unchanged").notNull().default(0),
  recordsRectified: integer("records_rectified").notNull().default(0),
  recordsUnavailable: integer("records_unavailable").notNull().default(0),
  progress: json("progress"),
});

/** Satellite fire detections (INPE). NOT confirmed fires. */
export const satelliteHotspots = pgTable("satellite_hotspots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: integer("source_id").notNull(),
  externalId: text("external_id").notNull(),
  satellite: text("satellite").notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  municipality: text("municipality"),
  municipalityIbgeCode: char("municipality_ibge_code", { length: 7 }),
  state: char("state", { length: 2 }),
  stateName: text("state_name"),
  biome: text("biome"),
  daysWithoutRain: integer("days_without_rain"),
  precipitationMm: doublePrecision("precipitation_mm"),
  fireRisk: doublePrecision("fire_risk"),
  frpMw: doublePrecision("frp_mw"),
  raw: json("raw"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  syncRunId: integer("sync_run_id"),
});

// Sisfogo (Ibama/Prevfogo) public ROI records (migration 0010).
export const sisfogoRoiRecords = pgTable("sisfogo_roi_records", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: integer("source_id").notNull(),
  externalId: text("external_id").notNull(),
  roiNumber: text("roi_number"),
  roiStatus: text("roi_status"),
  rectified: boolean("rectified"),
  startedOn: date("started_on", { mode: "string" }),
  startedLocalTime: text("started_local_time"),
  detectedOn: date("detected_on", { mode: "string" }),
  extinguishedOn: date("extinguished_on", { mode: "string" }),
  municipality: text("municipality"),
  municipalityIbgeCode: char("municipality_ibge_code", { length: 7 }),
  state: char("state", { length: 2 }),
  biome: text("biome"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  burnedAreaHa: doublePrecision("burned_area_ha"),
  vegetation: text("vegetation"),
  raw: json("raw").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  syncRunId: integer("sync_run_id"),
  // migration 0011 (contract verified against the live API)
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  detectedAt: timestamp("detected_at", { withTimezone: true }),
  dispatchAt: timestamp("dispatch_at", { withTimezone: true }),
  firstAttackAt: timestamp("first_attack_at", { withTimezone: true }),
  controlledAt: timestamp("controlled_at", { withTimezone: true }),
  extinguishedAt: timestamp("extinguished_at", { withTimezone: true }),
  institutionName: text("institution_name"),
  institutionAcronym: text("institution_acronym"),
  placeName: text("place_name"),
  localityType: text("locality_type"),
  areaClassification: text("area_classification"),
  legalAmazon: boolean("legal_amazon"),
  hadCombat: boolean("had_combat"),
  responseLevel: text("response_level"),
  structuresHit: text("structures_hit"),
  contentHash: text("content_hash"),
  revision: integer("revision").notNull().default(1),
  unavailableSince: timestamp("unavailable_since", { withTimezone: true }),
  lastSeenRunId: integer("last_seen_run_id"),
});
export type SisfogoRoiRecord = typeof sisfogoRoiRecords.$inferSelect;

/** Every distinct published version of an official record (migration 0011). */
export const sourceRecordRevisions = pgTable("source_record_revisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  dataSourceId: integer("data_source_id").notNull(),
  externalId: text("external_id").notNull(),
  revision: integer("revision").notNull(),
  changeKind: text("change_kind").notNull(), // novo | retificado | atualizado
  contentHash: text("content_hash").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  rectified: boolean("rectified"),
  raw: json("raw").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  syncRunId: integer("sync_run_id"),
});

export type SourceSyncRun = typeof sourceSyncRuns.$inferSelect;
export type SatelliteHotspot = typeof satelliteHotspots.$inferSelect;

// ─── AI traceability (migration 0007) ────────────────────────────────────────

export const modelVersions = pgTable("model_versions", {
  id: serial("id").primaryKey(),
  engineFamily: text("engine_family").notNull(),   // regras-python | regras-typescript | rf-sintetico
  version: text("version").notNull(),
  description: text("description").notNull(),
  datasetType: text("dataset_type").notNull(),     // nao-se-aplica | sintetico | real
  datasetDescription: text("dataset_description"),
  metrics: json("metrics"),
  metricsWarning: text("metrics_warning"),
  artifactSha256: text("artifact_sha256"),
  isExperimental: boolean("is_experimental").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskAnalysisSources = pgTable("risk_analysis_sources", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull(),
  sourceKey: text("source_key").notNull(),
  dataSourceId: integer("data_source_id"),
  fields: text("fields").array().notNull().default(sql`'{}'::text[]`),
  referenceAt: timestamp("reference_at", { withTimezone: true }),
  recordCount: integer("record_count"),
  detail: json("detail"),
});

export type ModelVersion = typeof modelVersions.$inferSelect;
export type RiskAnalysisSource = typeof riskAnalysisSources.$inferSelect;

// ─── Operational evidence (migration 0013) ───────────────────────────────────

export const opsHeartbeats = pgTable("ops_heartbeats", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  instance: text("instance").notNull(),
  dbOk: boolean("db_ok").notNull(),
  dbMs: integer("db_ms"),
  riskEngineOk: boolean("risk_engine_ok").notNull(),
  inpeFresh: boolean("inpe_fresh"),
  sisfogoFresh: boolean("sisfogo_fresh"),
});

export const opsRequestMetrics = pgTable("ops_request_metrics", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  minute: timestamp("minute", { withTimezone: true }).notNull(),
  route: text("route").notNull(),
  requests: integer("requests").notNull(),
  errors5xx: integer("errors_5xx").notNull(),
  errors4xx: integer("errors_4xx").notNull(),
  p50Ms: integer("p50_ms").notNull(),
  p95Ms: integer("p95_ms").notNull(),
  maxMs: integer("max_ms").notNull(),
});

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  organizationId: integer("organization_id"),
  page: text("page").notNull(),
  category: text("category").notNull(), // problema | sugestao | elogio | duvida
  rating: smallint("rating"),
  message: text("message").notNull(),
  status: text("status").notNull().default("novo"), // novo | em_analise | resolvido | arquivado
  response: text("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const susResponses = pgTable("sus_responses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  organizationId: integer("organization_id"),
  answers: smallint("answers").array().notNull(),
  score: doublePrecision("score").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Alert notifications (migration 0015) ───────────────────────────────────
export const NOTIFICATION_SEVERITIES = ["baixo", "moderado", "alto", "crítico"] as const;
export const notificationPreferences = pgTable("notification_preferences", {
  userId: integer("user_id").primaryKey(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  minSeverity: text("min_severity").notNull().default("alto"),
  kinds: text("kinds").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  userId: integer("user_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  channel: text("channel").notNull().default("email"),
  status: text("status").notNull().default("pendente"), // pendente | enviado | falha | bloqueado_configuracao
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;

// ─── Official municipal boundaries (migration 0016) ─────────────────────────
export const municipalityBoundaries = pgTable("municipality_boundaries", {
  ibgeCode: char("ibge_code", { length: 7 }).primaryKey(),
  boundary: json("boundary").notNull(),
  minLat: doublePrecision("min_lat").notNull(), maxLat: doublePrecision("max_lat").notNull(),
  minLng: doublePrecision("min_lng").notNull(), maxLng: doublePrecision("max_lng").notNull(),
  centroidLat: doublePrecision("centroid_lat").notNull(), centroidLng: doublePrecision("centroid_lng").notNull(),
  areaKm2: doublePrecision("area_km2").notNull(),
  quality: text("quality").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Proof of Value baseline (migration 0017) ───────────────────────────────
export const povBaselineMeasurements = pgTable("pov_baseline_measurements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  areaId: integer("area_id"),
  method: text("method").notNull().default("manual"),
  durationMs: integer("duration_ms").notNull(),
  sourcesConsulted: text("sources_consulted").array().notNull(),
  note: text("note"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
