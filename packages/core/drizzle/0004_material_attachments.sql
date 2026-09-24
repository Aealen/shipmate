ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "attachments" jsonb DEFAULT '[]' NOT NULL;
