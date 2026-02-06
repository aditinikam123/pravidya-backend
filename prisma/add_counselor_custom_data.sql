-- Add customData column to counselor_profiles for admin-defined custom fields
ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "customData" JSONB;
