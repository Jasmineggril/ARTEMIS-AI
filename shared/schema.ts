import { pgTable, text, serial, integer, boolean, timestamp, real, json } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const sensors = pgTable("sensors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  location: text("location").notNull(),
  status: text("status").notNull().default("active"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  lastPing: timestamp("last_ping").defaultNow(),
});

export const readings = pgTable("readings", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id").notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull(),
  isResolved: boolean("is_resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const weatherData = pgTable("weather_data", {
  id: serial("id").primaryKey(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  temperature: real("temperature"),
  humidity: real("humidity"),
  windSpeed: real("wind_speed"),
  windDirection: text("wind_direction"),
  rainfall: real("rainfall"),
  pressure: real("pressure"),
  uvIndex: real("uv_index"),
  condition: text("condition"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const userStats = pgTable("user_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  points: integer("points").default(0),
  level: integer("level").default(1),
  denunciasCount: integer("denuncias_count").default(0),
  achievement: text("achievement").default("iniciante"),
  lastActivity: timestamp("last_activity").defaultNow(),
});

export const denuncias = pgTable("denuncias", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull(),
  categoria: text("categoria").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  municipio: text("municipio"),
  status: text("status").default("pendente"),
  pontosAtribuidos: integer("pontos_atribuidos").default(50),
  createdAt: timestamp("created_at").defaultNow(),
});

export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  badgeId: text("badge_id").notNull(),
  badgeName: text("badge_name").notNull(),
  badgeDesc: text("badge_desc").notNull(),
  earnedAt: timestamp("earned_at").defaultNow(),
});

// ─── New tables for risk platform ────────────────────────────────────────────

/** Áreas produtivas monitoradas */
export const monitoredAreas = pgTable("monitored_areas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  operationType: text("operation_type").notNull(), // 'agroindústria', 'florestal', 'energia', 'mineração', 'logística', 'outro'
  municipality: text("municipality").notNull(),
  state: text("state").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  areaHectares: real("area_hectares"),
  status: text("status").notNull().default("ativo"), // 'ativo', 'inativo', 'em análise'
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Análises de risco executadas */
export const riskAnalyses = pgTable("risk_analyses", {
  id: serial("id").primaryKey(),
  areaId: integer("area_id"),
  score: integer("score").notNull(),
  level: text("level").notNull(), // 'baixo' | 'moderado' | 'alto' | 'crítico'
  confidence: real("confidence"),
  inputData: json("input_data"),
  factors: json("factors"),
  recommendations: json("recommendations"),
  isSimulated: boolean("is_simulated").default(true),
  calculationVersion: text("calculation_version").default("1.0.0"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Fontes de dados disponíveis */
export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'estação climática', 'sensor IoT', 'API ambiental', 'base histórica', 'base geográfica', 'entrada manual', 'simulação'
  status: text("status").notNull().default("simulado"), // 'ativo', 'simulado', 'em integração', 'indisponível'
  isSimulated: boolean("is_simulated").default(true),
  lastUpdate: timestamp("last_update").defaultNow(),
  quality: real("quality"), // 0–1
  description: text("description"),
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
  importedAt: timestamp("imported_at").defaultNow(),
  importedBy: integer("imported_by"),
  status: text("status").notNull().default("concluído"),
  notes: text("notes"),
});

/** Ocorrências de incêndio importadas */
export const fireOccurrences = pgTable("fire_occurrences", {
  id: serial("id").primaryKey(),
  importBatchId: integer("import_batch_id").notNull(),
  occurrenceDate: text("occurrence_date"),
  occurrenceTime: text("occurrence_time"),
  municipality: text("municipality"),
  state: text("state"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  occurrenceType: text("occurrence_type"),
  occurrenceStatus: text("occurrence_status"),
  affectedArea: real("affected_area"),
  cause: text("cause"),
  vegetationCondition: text("vegetation_condition"),
  notes: text("notes"),
  source: text("source"),
  sourceReference: text("source_reference"),
  validationStatus: text("validation_status").notNull().default("válido"),
  rawData: json("raw_data"),
  createdAt: timestamp("created_at").defaultNow(),
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
