-- Add fullName column to academy_users (run this if the column is missing)
-- Run with: psql $DATABASE_URL -f prisma/add-fullName-to-academy-users.sql
-- Or run the line below in your DB client (Neon SQL Editor, etc.)

ALTER TABLE academy_users ADD COLUMN IF NOT EXISTS "fullName" TEXT;
