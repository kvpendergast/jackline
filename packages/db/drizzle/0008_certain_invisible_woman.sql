CREATE TYPE "public"."tool_http_method" AS ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD');--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "http_method" "tool_http_method";--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "path_template" text;