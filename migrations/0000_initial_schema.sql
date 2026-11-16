CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"badge_id" text NOT NULL,
	"badge_name" text NOT NULL,
	"badge_desc" text NOT NULL,
	"earned_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text NOT NULL,
	"is_resolved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'simulado' NOT NULL,
	"is_simulated" boolean DEFAULT true,
	"last_update" timestamp DEFAULT now(),
	"quality" real,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "denuncias" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"titulo" text NOT NULL,
	"descricao" text NOT NULL,
	"categoria" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"municipio" text,
	"status" text DEFAULT 'pendente',
	"pontos_atribuidos" integer DEFAULT 50,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monitored_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"operation_type" text NOT NULL,
	"municipality" text NOT NULL,
	"state" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"area_hectares" real,
	"status" text DEFAULT 'ativo' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer,
	"score" integer NOT NULL,
	"level" text NOT NULL,
	"confidence" real,
	"input_data" json,
	"factors" json,
	"recommendations" json,
	"is_simulated" boolean DEFAULT true,
	"calculation_version" text DEFAULT '1.0.0',
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sensors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"latitude" real,
	"longitude" real,
	"last_ping" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"points" integer DEFAULT 0,
	"level" integer DEFAULT 1,
	"denuncias_count" integer DEFAULT 0,
	"achievement" text DEFAULT 'iniciante',
	"last_activity" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"first_name" text DEFAULT '',
	"last_name" text DEFAULT '',
	"role" text DEFAULT 'user',
	"bio" text DEFAULT '',
	"avatar" text DEFAULT '',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weather_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"temperature" real,
	"humidity" real,
	"wind_speed" real,
	"wind_direction" text,
	"rainfall" real,
	"pressure" real,
	"uv_index" real,
	"condition" text,
	"timestamp" timestamp DEFAULT now()
);

