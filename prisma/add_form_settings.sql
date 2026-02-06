-- Create app_settings table if it doesn't exist (required for first run)
CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed counselor fields (if not already present)
INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
VALUES (
  'clx_settings_default',
  'counselorFields',
  '{"username":true,"email":true,"password":true,"fullName":true,"mobile":true,"expertise":true,"languages":true,"availability":true,"maxCapacity":true,"schoolId":true}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- Seed default form field settings for all forms
INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
VALUES 
  ('clx_institution_fields', 'institutionFields', '{"name":true,"type":true,"address":true,"city":true,"state":true,"isActive":true,"logoUrl":true,"boardsOffered":true,"standardsAvailable":true,"streamsOffered":true,"admissionsOpen":true,"boardGradeMap":true}'::jsonb, CURRENT_TIMESTAMP),
  ('clx_course_fields', 'courseFields', '{"name":true,"code":true,"description":true,"institution":true,"duration":true,"eligibility":true,"isActive":true,"board":true,"standardRange":true,"stream":true,"seats":true,"admissionsOpen":true}'::jsonb, CURRENT_TIMESTAMP),
  ('clx_school_fields', 'schoolFields', '{"name":true,"board":true,"city":true,"state":true,"academicYear":true,"contactEmail":true,"contactPhone":true,"address":true,"capacity":true,"pockets":true}'::jsonb, CURRENT_TIMESTAMP),
  ('clx_admission_fields', 'admissionFormFields', '{"parentName":true,"parentMobile":true,"parentEmail":true,"parentCity":true,"preferredLanguage":true,"studentName":true,"dateOfBirth":true,"gender":true,"currentClass":true,"boardUniversity":true,"marksPercentage":true,"institution":true,"course":true,"academicYear":true,"preferredCounselingMode":true,"notes":true}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
