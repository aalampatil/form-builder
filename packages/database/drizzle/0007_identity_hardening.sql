DO $$ BEGIN
  IF EXISTS (SELECT lower(btrim(email)) FROM public.users GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized user emails; reconcile identities before migration';
  END IF;
  IF EXISTS (SELECT token_hash FROM public.sessions GROUP BY token_hash HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate session token hashes; revoke and reconcile sessions before migration';
  END IF;
END $$;
--> statement-breakpoint
UPDATE public.users SET email = lower(btrim(email));
--> statement-breakpoint
ALTER TABLE "forms" DROP CONSTRAINT "forms_owner_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "sessions_token_hash_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_normalized_email_unique" ON "users" USING btree (lower(btrim("email")));--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email")));
