CREATE TYPE "public"."user_kind" AS ENUM('human', 'service');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "kind" "user_kind" DEFAULT 'human' NOT NULL;