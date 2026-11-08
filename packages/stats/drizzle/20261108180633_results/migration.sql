CREATE TABLE "results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"play_hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scenario_id" text NOT NULL,
	"seed" double precision NOT NULL,
	"start_date" text NOT NULL,
	"stack_index" smallint NOT NULL,
	"framework" text NOT NULL,
	"rewound" boolean NOT NULL,
	"end_reason" text NOT NULL,
	"end_month" smallint NOT NULL,
	"outages" smallint NOT NULL,
	"cash" double precision NOT NULL,
	"satisfaction" double precision NOT NULL,
	"feature_points" double precision NOT NULL,
	"edge_months" smallint NOT NULL,
	"save" jsonb NOT NULL,
	CONSTRAINT "results_end_reason_check" CHECK ("end_reason" in ('completed', 'cash', 'outages', 'policy'))
);
--> statement-breakpoint
CREATE INDEX "results_histogram_idx" ON "results" ("scenario_id","end_reason","rewound","seed");