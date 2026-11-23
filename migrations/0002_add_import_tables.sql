CREATE TABLE IF NOT EXISTS "fire_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_batch_id" integer NOT NULL,
	"occurrence_date" text,
	"occurrence_time" text,
	"municipality" text,
	"state" text,
	"latitude" real,
	"longitude" real,
	"occurrence_type" text,
	"occurrence_status" text,
	"affected_area" real,
	"cause" text,
	"vegetation_condition" text,
	"notes" text,
	"source" text,
	"source_reference" text,
	"validation_status" text DEFAULT 'válido' NOT NULL,
	"raw_data" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT 'arquivo importado' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp DEFAULT now(),
	"imported_by" integer,
	"status" text DEFAULT 'concluído' NOT NULL,
	"notes" text
);
