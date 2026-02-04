-- Add leadId to todos for linking todos to leads (counselor's assigned leads)
ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE INDEX IF NOT EXISTS "todos_leadId_idx" ON "todos"("leadId");

ALTER TABLE "todos" DROP CONSTRAINT IF EXISTS "todos_leadId_fkey";
ALTER TABLE "todos" ADD CONSTRAINT "todos_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
