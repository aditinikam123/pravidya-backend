-- Create Enums
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COUNSELOR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "Availability" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InstitutionType" AS ENUM ('School', 'College');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "Gender" AS ENUM ('Male', 'Female', 'Other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CounselingMode" AS ENUM ('Online', 'Offline');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "Classification" AS ENUM ('RAW', 'VERIFIED', 'PRIORITY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'ENROLLED', 'REJECTED', 'ON_HOLD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContentType" AS ENUM ('VIDEO', 'DOCUMENT', 'LINK');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "EntityType" AS ENUM ('LEAD', 'COUNSELOR', 'INSTITUTION', 'COURSE', 'SESSION', 'TRAINING', 'USER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'COUNSELOR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users"("role");
CREATE INDEX IF NOT EXISTS "users_isActive_idx" ON "users"("isActive");

-- Create counselor_profiles table
CREATE TABLE IF NOT EXISTS "counselor_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "mobile" TEXT NOT NULL,
  "expertise" TEXT[],
  "languages" TEXT[],
  "availability" "Availability" NOT NULL DEFAULT 'ACTIVE',
  "maxCapacity" INTEGER NOT NULL DEFAULT 50,
  "currentLoad" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "counselor_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "counselor_profiles_userId_key" ON "counselor_profiles"("userId");
CREATE INDEX IF NOT EXISTS "counselor_profiles_availability_idx" ON "counselor_profiles"("availability");
CREATE INDEX IF NOT EXISTS "counselor_profiles_currentLoad_idx" ON "counselor_profiles"("currentLoad");
ALTER TABLE "counselor_profiles" ADD CONSTRAINT IF NOT EXISTS "counselor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create institutions table
CREATE TABLE IF NOT EXISTS "institutions" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "InstitutionType" NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "institutions_name_key" ON "institutions"("name");

-- Create courses table
CREATE TABLE IF NOT EXISTS "courses" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT,
  "institutionId" TEXT NOT NULL,
  "duration" TEXT,
  "eligibility" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "courses_code_key" ON "courses"("code") WHERE "code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "courses_institutionId_idx" ON "courses"("institutionId");
ALTER TABLE "courses" ADD CONSTRAINT IF NOT EXISTS "courses_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create leads table
CREATE TABLE IF NOT EXISTS "leads" (
  "id" TEXT NOT NULL,
  "leadId" TEXT,
  "parentName" TEXT NOT NULL,
  "parentMobile" TEXT NOT NULL,
  "parentEmail" TEXT NOT NULL,
  "parentCity" TEXT NOT NULL,
  "preferredLanguage" TEXT NOT NULL,
  "studentName" TEXT NOT NULL,
  "dateOfBirth" TIMESTAMP(3) NOT NULL,
  "gender" "Gender" NOT NULL,
  "currentClass" TEXT NOT NULL,
  "boardUniversity" TEXT,
  "marksPercentage" DOUBLE PRECISION,
  "institutionId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "academicYear" TEXT NOT NULL,
  "preferredCounselingMode" "CounselingMode" NOT NULL,
  "notes" TEXT,
  "consent" BOOLEAN NOT NULL DEFAULT false,
  "classification" "Classification" NOT NULL DEFAULT 'RAW',
  "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
  "assignedCounselorId" TEXT,
  "autoAssigned" BOOLEAN NOT NULL DEFAULT false,
  "assignmentReason" TEXT NOT NULL DEFAULT '',
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "leads_leadId_key" ON "leads"("leadId") WHERE "leadId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "leads_assignedCounselorId_idx" ON "leads"("assignedCounselorId");
CREATE INDEX IF NOT EXISTS "leads_autoAssigned_idx" ON "leads"("autoAssigned");
CREATE INDEX IF NOT EXISTS "leads_classification_idx" ON "leads"("classification");
CREATE INDEX IF NOT EXISTS "leads_priority_idx" ON "leads"("priority");
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");
CREATE INDEX IF NOT EXISTS "leads_submittedAt_idx" ON "leads"("submittedAt" DESC);
CREATE INDEX IF NOT EXISTS "leads_parentEmail_idx" ON "leads"("parentEmail");
CREATE INDEX IF NOT EXISTS "leads_parentMobile_idx" ON "leads"("parentMobile");
CREATE INDEX IF NOT EXISTS "leads_institutionId_idx" ON "leads"("institutionId");
CREATE INDEX IF NOT EXISTS "leads_courseId_idx" ON "leads"("courseId");
CREATE INDEX IF NOT EXISTS "leads_assignedCounselorId_status_idx" ON "leads"("assignedCounselorId", "status");
CREATE INDEX IF NOT EXISTS "leads_classification_priority_idx" ON "leads"("classification", "priority");
CREATE INDEX IF NOT EXISTS "leads_autoAssigned_assignedCounselorId_idx" ON "leads"("autoAssigned", "assignedCounselorId");
ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_assignedCounselorId_fkey" FOREIGN KEY ("assignedCounselorId") REFERENCES "counselor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create counseling_sessions table
CREATE TABLE IF NOT EXISTS "counseling_sessions" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "counselorId" TEXT NOT NULL,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "mode" "CounselingMode" NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "remarks" TEXT,
  "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  "followUpDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "counseling_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "counseling_sessions_leadId_idx" ON "counseling_sessions"("leadId");
CREATE INDEX IF NOT EXISTS "counseling_sessions_counselorId_idx" ON "counseling_sessions"("counselorId");
ALTER TABLE "counseling_sessions" ADD CONSTRAINT IF NOT EXISTS "counseling_sessions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "counseling_sessions" ADD CONSTRAINT IF NOT EXISTS "counseling_sessions_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create training_content table
CREATE TABLE IF NOT EXISTS "training_content" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "ContentType" NOT NULL,
  "fileUrl" TEXT,
  "fileName" TEXT,
  "fileSize" INTEGER,
  "mimeType" TEXT,
  "uploadedById" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_content_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "training_content_type_idx" ON "training_content"("type");
CREATE INDEX IF NOT EXISTS "training_content_isActive_idx" ON "training_content"("isActive");
ALTER TABLE "training_content" ADD CONSTRAINT IF NOT EXISTS "training_content_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create todos table
CREATE TABLE IF NOT EXISTS "todos" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TodoStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "todos_userId_idx" ON "todos"("userId");
CREATE INDEX IF NOT EXISTS "todos_status_idx" ON "todos"("status");
ALTER TABLE "todos" ADD CONSTRAINT IF NOT EXISTS "todos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create activity_logs table
CREATE TABLE IF NOT EXISTS "activity_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" "EntityType" NOT NULL,
  "entityId" TEXT,
  "details" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "activity_logs_entityType_entityId_idx" ON "activity_logs"("entityType", "entityId");
ALTER TABLE "activity_logs" ADD CONSTRAINT IF NOT EXISTS "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
