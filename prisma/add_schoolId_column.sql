-- Add schoolId column to counselor_profiles table
-- This fixes the error: "The column 'counselor_profiles.schoolId' does not exist"

-- Step 1: Add the schoolId column (nullable, since it's optional)
ALTER TABLE counselor_profiles 
ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- Step 2: Create index on schoolId for better query performance
CREATE INDEX IF NOT EXISTS "counselor_profiles_schoolId_idx" ON counselor_profiles("schoolId");

-- Step 3: Add foreign key constraint (if School table exists)
-- Note: This will fail if School table doesn't exist yet, which is OK
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schools') THEN
        -- Add foreign key constraint
        ALTER TABLE counselor_profiles
        ADD CONSTRAINT "counselor_profiles_schoolId_fkey" 
        FOREIGN KEY ("schoolId") 
        REFERENCES schools(id) 
        ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        -- Constraint already exists, ignore
        NULL;
END $$;

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'counselor_profiles' 
AND column_name = 'schoolId';
