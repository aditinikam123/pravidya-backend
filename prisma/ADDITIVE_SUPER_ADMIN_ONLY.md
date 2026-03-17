# Add Super Admin schema without dropping existing data

If `prisma migrate dev` asks to **drop** columns or tables (e.g. `onboardingStatus`, `schoolId`, `enrollmentConfirmed`, etc.), **do not** accept that migration. It would delete existing data.

Use this **additive-only** flow instead. It only **adds** new columns and the `super_admins` table and does **not** remove anything.

## Step 1: Cancel the current migration

In the terminal where Prisma is waiting:

- Type **`n`** (or **No**) and press Enter when asked:  
  `Do you want to ignore the warning(s)?`

Do **not** run `prisma migrate dev` for this change.

## Step 2: Apply only the additive SQL

From the **backend** folder (`pravidya/backend`), run:

```bash
npx prisma db execute --file prisma/migrations/add_super_admin_and_institution_scope.sql
```

Or with `psql`:

```bash
psql "%DATABASE_URL%" -f prisma/migrations/add_super_admin_and_institution_scope.sql
```

(On Windows use `%DATABASE_URL%`; on Mac/Linux use `$DATABASE_URL`.)

This script:

- Adds `jitofyInstitutionId` to `institutions` (if missing)
- Adds `institutionId` to `users` (if missing)
- Creates the `super_admins` table (if missing)
- Does **not** drop any columns or tables

## Step 3: Regenerate Prisma Client

```bash
npx prisma generate
```

## Step 4: Seed Super Admin (optional)

```bash
npm run seed:superadmin
```

After this, your existing data is unchanged and the Super Admin schema is in place.
