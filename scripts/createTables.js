import dotenv from 'dotenv';
import { prisma } from '../prisma/client.js';

dotenv.config();

const createTables = async () => {
  try {
    console.log('🔨 Creating database tables...\n');

    // Create enums first
    console.log('Creating enums...');
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COUNSELOR');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "Availability" AS ENUM ('ACTIVE', 'INACTIVE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "InstitutionType" AS ENUM ('School', 'College');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "Gender" AS ENUM ('Male', 'Female', 'Other');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "CounselingMode" AS ENUM ('Online', 'Offline');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "Classification" AS ENUM ('RAW', 'VERIFIED', 'PRIORITY');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'ENROLLED', 'REJECTED', 'ON_HOLD');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "ContentType" AS ENUM ('VIDEO', 'DOCUMENT', 'LINK');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "EntityType" AS ENUM ('LEAD', 'COUNSELOR', 'INSTITUTION', 'COURSE', 'SESSION', 'TRAINING', 'USER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    console.log('✅ Enums created\n');

    // Create users table
    console.log('Creating users table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");`;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users"("role");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "users_isActive_idx" ON "users"("isActive");`;
    console.log('✅ Users table created');

    // Create counselor_profiles table
    console.log('Creating counselor_profiles table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "counselor_profiles_userId_key" ON "counselor_profiles"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "counselor_profiles_availability_idx" ON "counselor_profiles"("availability");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "counselor_profiles_currentLoad_idx" ON "counselor_profiles"("currentLoad");`;
    await prisma.$executeRaw`ALTER TABLE "counselor_profiles" ADD CONSTRAINT IF NOT EXISTS "counselor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Counselor profiles table created');

    // Create institutions table
    console.log('Creating institutions table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "institutions_name_key" ON "institutions"("name");`;
    console.log('✅ Institutions table created');

    // Create courses table
    console.log('Creating courses table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "courses_code_key" ON "courses"("code") WHERE "code" IS NOT NULL;`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "courses_institutionId_idx" ON "courses"("institutionId");`;
    await prisma.$executeRaw`ALTER TABLE "courses" ADD CONSTRAINT IF NOT EXISTS "courses_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Courses table created');

    // Create leads table
    console.log('Creating leads table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "leads_leadId_key" ON "leads"("leadId") WHERE "leadId" IS NOT NULL;`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_assignedCounselorId_idx" ON "leads"("assignedCounselorId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_autoAssigned_idx" ON "leads"("autoAssigned");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_classification_idx" ON "leads"("classification");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_priority_idx" ON "leads"("priority");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_submittedAt_idx" ON "leads"("submittedAt" DESC);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_parentEmail_idx" ON "leads"("parentEmail");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_parentMobile_idx" ON "leads"("parentMobile");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_institutionId_idx" ON "leads"("institutionId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_courseId_idx" ON "leads"("courseId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_assignedCounselorId_status_idx" ON "leads"("assignedCounselorId", "status");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_classification_priority_idx" ON "leads"("classification", "priority");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "leads_autoAssigned_assignedCounselorId_idx" ON "leads"("autoAssigned", "assignedCounselorId");`;
    await prisma.$executeRaw`ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`;
    await prisma.$executeRaw`ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`;
    await prisma.$executeRaw`ALTER TABLE "leads" ADD CONSTRAINT IF NOT EXISTS "leads_assignedCounselorId_fkey" FOREIGN KEY ("assignedCounselorId") REFERENCES "counselor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;`;
    console.log('✅ Leads table created');

    // Create counseling_sessions table
    console.log('Creating counseling_sessions table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "counseling_sessions_leadId_idx" ON "counseling_sessions"("leadId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "counseling_sessions_counselorId_idx" ON "counseling_sessions"("counselorId");`;
    await prisma.$executeRaw`ALTER TABLE "counseling_sessions" ADD CONSTRAINT IF NOT EXISTS "counseling_sessions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    await prisma.$executeRaw`ALTER TABLE "counseling_sessions" ADD CONSTRAINT IF NOT EXISTS "counseling_sessions_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Counseling sessions table created');

    // Create training_content table
    console.log('Creating training_content table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "training_content_type_idx" ON "training_content"("type");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "training_content_isActive_idx" ON "training_content"("isActive");`;
    await prisma.$executeRaw`ALTER TABLE "training_content" ADD CONSTRAINT IF NOT EXISTS "training_content_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Training content table created');

    // Create todos table
    console.log('Creating todos table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "todos_userId_idx" ON "todos"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "todos_status_idx" ON "todos"("status");`;
    await prisma.$executeRaw`ALTER TABLE "todos" ADD CONSTRAINT IF NOT EXISTS "todos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Todos table created');

    // Create activity_logs table
    console.log('Creating activity_logs table...');
    await prisma.$executeRaw`
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
    `;
    
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt" DESC);`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "activity_logs_entityType_entityId_idx" ON "activity_logs"("entityType", "entityId");`;
    await prisma.$executeRaw`ALTER TABLE "activity_logs" ADD CONSTRAINT IF NOT EXISTS "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    console.log('✅ Activity logs table created');

    console.log('\n✅ All tables created successfully!');
    console.log('You can now run: npm run seed\n');

  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
    if (error.message.includes('already exists')) {
      console.log('⚠️  Some tables may already exist. This is okay - continuing...');
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
};

createTables();
