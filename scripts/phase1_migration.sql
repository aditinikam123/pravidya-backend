-- Phase-1 Database Migration
-- Run this in Neon Console SQL Editor after running create_tables.sql

-- Add MANAGEMENT role to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGEMENT';

-- Add AWAY and OFFLINE to Availability enum
ALTER TYPE "Availability" ADD VALUE IF NOT EXISTS 'AWAY';
ALTER TYPE "Availability" ADD VALUE IF NOT EXISTS 'OFFLINE';

-- Add SchoolBoard enum
DO $$ BEGIN
  CREATE TYPE "SchoolBoard" AS ENUM ('CBSE', 'ICSE', 'STATE', 'IGCSE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add TrainingStatus enum
DO $$ BEGIN
  CREATE TYPE "TrainingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add PresenceStatus enum
DO $$ BEGIN
  CREATE TYPE "PresenceStatus" AS ENUM ('ACTIVE', 'AWAY', 'OFFLINE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add AttendanceStatus enum
DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'PARTIAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add SCHOOL and QUESTION to EntityType enum
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'SCHOOL';
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'QUESTION';

-- Add schoolId to counselor_profiles
ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- Create schools table
CREATE TABLE IF NOT EXISTS "schools" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "board" "SchoolBoard" NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "academicYear" TEXT NOT NULL,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "address" TEXT,
  "capacity" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "schools_name_key" ON "schools"("name");
CREATE INDEX IF NOT EXISTS "schools_board_idx" ON "schools"("board");
CREATE INDEX IF NOT EXISTS "schools_city_state_idx" ON "schools"("city", "state");
CREATE INDEX IF NOT EXISTS "schools_isActive_idx" ON "schools"("isActive");

-- Create school_pockets table
CREATE TABLE IF NOT EXISTS "school_pockets" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "school_pockets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "school_pockets_schoolId_idx" ON "school_pockets"("schoolId");
ALTER TABLE "school_pockets" ADD CONSTRAINT IF NOT EXISTS "school_pockets_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key for schoolId in counselor_profiles
ALTER TABLE "counselor_profiles" ADD CONSTRAINT IF NOT EXISTS "counselor_profiles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create training_modules table
CREATE TABLE IF NOT EXISTS "training_modules" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "videoUrl" TEXT,
  "documentUrl" TEXT,
  "linkUrl" TEXT,
  "duration" INTEGER,
  "tags" TEXT[],
  "schoolId" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_modules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "training_modules_isPublished_idx" ON "training_modules"("isPublished");
CREATE INDEX IF NOT EXISTS "training_modules_schoolId_idx" ON "training_modules"("schoolId");
CREATE INDEX IF NOT EXISTS "training_modules_createdById_idx" ON "training_modules"("createdById");
ALTER TABLE "training_modules" ADD CONSTRAINT IF NOT EXISTS "training_modules_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_modules" ADD CONSTRAINT IF NOT EXISTS "training_modules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create training_progress table
CREATE TABLE IF NOT EXISTS "training_progress" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "counselorId" TEXT NOT NULL,
  "status" "TrainingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "training_progress_moduleId_counselorId_key" ON "training_progress"("moduleId", "counselorId");
CREATE INDEX IF NOT EXISTS "training_progress_counselorId_idx" ON "training_progress"("counselorId");
CREATE INDEX IF NOT EXISTS "training_progress_status_idx" ON "training_progress"("status");
ALTER TABLE "training_progress" ADD CONSTRAINT IF NOT EXISTS "training_progress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "training_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_progress" ADD CONSTRAINT IF NOT EXISTS "training_progress_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create counselor_presence table
CREATE TABLE IF NOT EXISTS "counselor_presence" (
  "id" TEXT NOT NULL,
  "counselorId" TEXT NOT NULL,
  "lastLoginAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3),
  "status" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
  "activeMinutesToday" INTEGER NOT NULL DEFAULT 0,
  "totalActiveMinutes" INTEGER NOT NULL DEFAULT 0,
  "lastStatusChange" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "counselor_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "counselor_presence_counselorId_key" ON "counselor_presence"("counselorId");
CREATE INDEX IF NOT EXISTS "counselor_presence_status_idx" ON "counselor_presence"("status");
CREATE INDEX IF NOT EXISTS "counselor_presence_lastActivityAt_idx" ON "counselor_presence"("lastActivityAt");
ALTER TABLE "counselor_presence" ADD CONSTRAINT IF NOT EXISTS "counselor_presence_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create daily_attendance table
CREATE TABLE IF NOT EXISTS "daily_attendance" (
  "id" TEXT NOT NULL,
  "counselorId" TEXT NOT NULL,
  "presenceId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "loginTime" TIMESTAMP(3),
  "logoutTime" TIMESTAMP(3),
  "activeMinutes" INTEGER NOT NULL DEFAULT 0,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_attendance_counselorId_date_key" ON "daily_attendance"("counselorId", "date");
CREATE INDEX IF NOT EXISTS "daily_attendance_date_idx" ON "daily_attendance"("date");
CREATE INDEX IF NOT EXISTS "daily_attendance_status_idx" ON "daily_attendance"("status");
ALTER TABLE "daily_attendance" ADD CONSTRAINT IF NOT EXISTS "daily_attendance_presenceId_fkey" FOREIGN KEY ("presenceId") REFERENCES "counselor_presence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create questions table
CREATE TABLE IF NOT EXISTS "questions" (
  "id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "questions_isActive_idx" ON "questions"("isActive");
CREATE INDEX IF NOT EXISTS "questions_createdById_idx" ON "questions"("createdById");
ALTER TABLE "questions" ADD CONSTRAINT IF NOT EXISTS "questions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create responses table
CREATE TABLE IF NOT EXISTS "responses" (
  "id" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "counselorId" TEXT NOT NULL,
  "sessionId" TEXT,
  "leadId" TEXT,
  "answer" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "responses_counselorId_idx" ON "responses"("counselorId");
CREATE INDEX IF NOT EXISTS "responses_questionId_idx" ON "responses"("questionId");
CREATE INDEX IF NOT EXISTS "responses_sessionId_idx" ON "responses"("sessionId");
CREATE INDEX IF NOT EXISTS "responses_leadId_idx" ON "responses"("leadId");
ALTER TABLE "responses" ADD CONSTRAINT IF NOT EXISTS "responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "responses" ADD CONSTRAINT IF NOT EXISTS "responses_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "responses" ADD CONSTRAINT IF NOT EXISTS "responses_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "counseling_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "responses" ADD CONSTRAINT IF NOT EXISTS "responses_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create scores table
CREATE TABLE IF NOT EXISTS "scores" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "category" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scores_responseId_idx" ON "scores"("responseId");
CREATE INDEX IF NOT EXISTS "scores_createdById_idx" ON "scores"("createdById");
ALTER TABLE "scores" ADD CONSTRAINT IF NOT EXISTS "scores_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scores" ADD CONSTRAINT IF NOT EXISTS "scores_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
