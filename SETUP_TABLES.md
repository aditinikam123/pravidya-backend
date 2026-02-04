# Setting Up Database Tables

Due to Windows TLS/SSL connection issues with Prisma CLI, you have two options to create the database tables:

## Option 1: Use Neon Console SQL Editor (Recommended - Easiest)

1. **Go to Neon Console**: https://console.neon.tech
2. **Select your project** (ep-morning-fire-ahgqddjf)
3. **Open SQL Editor** (usually in the left sidebar)
4. **Copy the contents** of `scripts/create_tables.sql`
5. **Paste and run** the SQL in the Neon SQL Editor
6. **Verify tables were created** - you should see all tables listed

After running the SQL, you can then run:
```powershell
npm run seed
```

## Option 2: Use Prisma CLI (If network issues are resolved)

If you can resolve the network/proxy issues preventing Prisma from downloading binaries:

```powershell
cd C:\Users\aditi\OneDrive\Desktop\pravidya\pravidya\backend
npm run prisma:push
```

Or if Prisma is installed globally:
```powershell
prisma db push
```

## Option 3: Use psql Command Line (If you have PostgreSQL client)

If you have `psql` installed, you can run:

```powershell
psql "postgresql://neondb_owner:npg_6GqQn9eatDSX@ep-morning-fire-ahgqddjf-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require" -f scripts/create_tables.sql
```

## What the SQL Script Does

The `create_tables.sql` script will:
1. Create all required PostgreSQL enums (UserRole, Availability, etc.)
2. Create all tables (users, counselor_profiles, institutions, courses, leads, etc.)
3. Create all indexes for performance
4. Set up all foreign key relationships

## After Tables Are Created

Once the tables are created (using any method above), you can:

1. **Run the seed script** to populate with sample data:
   ```powershell
   npm run seed
   ```

2. **Verify the setup** by checking the database in Neon console

3. **Start your server**:
   ```powershell
   npm start
   ```

## Troubleshooting

- If you get "table already exists" errors, that's okay - the script uses `IF NOT EXISTS` clauses
- If you get foreign key errors, make sure to run the entire script in order
- The SQL script is idempotent - you can run it multiple times safely
