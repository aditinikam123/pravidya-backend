# Add Lead Calls (Add-Only Migration)

This migration **only adds new tables**. It does NOT modify or drop any existing columns or data.

## Steps (do NOT use `prisma db push`)

1. **Run the SQL migration** (adds `call_dispositions` and `lead_calls` tables only):
   ```bash
   npx prisma db execute --file prisma/migrations/add_lead_calls_manual.sql
   ```

2. **Generate Prisma client** (updates client code for new models):
   ```bash
   npx prisma generate
   ```

3. **Seed call dispositions**:
   ```bash
   npm run seed:dispositions
   ```

## Important

- **Do NOT run `npx prisma db push`** – it compares schema to DB and may try to drop or alter existing columns.
- Existing data in `leads`, `counselor_profiles`, `counseling_sessions`, `todos`, etc. remains unchanged.
