-- D-166・D-169・D-171（drizzle-kit generate の出力に、すでにある行を埋める手順を手で足した。生成し直すときは同じ手当てをする）。
-- 前の migration（20261108180633_results）の後に、すでに行があっても通るようにする:
--   play_id … 前の行は 'legacy-<id>'（端末ごとのプレイの id が無かった行。web の形の id とは重ならない）
--   stack_id … 前の行は stack_index を、この migration を書いた時点（2026-11-09）の STACKS の並びで id に引き直す
--   total_cost … 前の行は null（④ がギリギリを攻めるだった版。保存の jsonb を再生し直せば数えられる。分布には入れない）
ALTER TABLE "results" DROP CONSTRAINT "results_play_hash_key";--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "play_id" text;--> statement-breakpoint
UPDATE "results" SET "play_id" = 'legacy-' || "id"::text WHERE "play_id" IS NULL;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "play_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "stack_id" text;--> statement-breakpoint
UPDATE "results" SET "stack_id" = CASE "stack_index"
	WHEN 0 THEN 'cloudflare-vinext-free'
	WHEN 1 THEN 'cloudflare-vinext-paid'
	WHEN 2 THEN 'vercel-supabase-hobby'
	WHEN 3 THEN 'vercel-supabase-pro'
	WHEN 4 THEN 'sakura-vps-2gb'
	WHEN 5 THEN 'sakura-vps-4gb'
	WHEN 6 THEN 'aws-amplify'
	WHEN 7 THEN 'aws-opennext'
	WHEN 8 THEN 'netlify-supabase-free'
	WHEN 9 THEN 'netlify-supabase-personal'
	WHEN 10 THEN 'netlify-supabase-pro'
	WHEN 11 THEN 'gcp-cloud-run'
	ELSE 'unknown-' || "stack_index"::text
END WHERE "stack_id" IS NULL;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "stack_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "total_cost" double precision;--> statement-breakpoint
ALTER TABLE "results" DROP COLUMN "stack_index";--> statement-breakpoint
ALTER TABLE "results" DROP COLUMN "edge_months";--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_play_id_key" UNIQUE("play_id");
