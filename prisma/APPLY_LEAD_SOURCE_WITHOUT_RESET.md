# Apply lead source tracking without resetting the database

When `npx prisma migrate dev` reports "drift" and asks to reset (which would delete all data), use this instead.

From the backend directory run:

```bash
npx prisma db execute --file prisma/migrations/add_lead_source_tracking.sql
```

Then regenerate the Prisma client:

```bash
npx prisma generate
```

This adds only the `LeadSource` enum and the new lead-tracking columns; no data is lost.
