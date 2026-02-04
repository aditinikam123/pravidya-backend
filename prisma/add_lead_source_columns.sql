-- Add leadSource and sourceCollege for external college enquiry API
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "leadSource" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "sourceCollege" TEXT;
CREATE INDEX IF NOT EXISTS "leads_leadSource_idx" ON "leads"("leadSource");
