-- Create app_settings table for admin-configurable settings
CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default counselor fields (all enabled by default)
INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
VALUES (
  'clx_settings_default',
  'counselorFields',
  '{"username":true,"email":true,"password":true,"fullName":true,"mobile":true,"expertise":true,"languages":true,"availability":true,"maxCapacity":true,"schoolId":true}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
