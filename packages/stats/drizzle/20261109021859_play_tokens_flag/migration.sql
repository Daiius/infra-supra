ALTER TABLE "results" ADD COLUMN "flag" text;--> statement-breakpoint
CREATE INDEX "results_dup_cap_idx" ON "results" ("play_hash","created_at");--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_flag_check" CHECK ("flag" is null or "flag" in ('no-token', 'bad-token', 'too-fast', 'dup-cap'));