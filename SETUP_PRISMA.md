# Prisma Setup Instructions

## ⚠️ Issue: npm cache is set to "only-if-cached" mode

Your npm is configured to only use cached packages, which prevents downloading Prisma CLI.

## 🔧 Solution Options:

### Option 1: Install Prisma globally (Easiest)
Open a **NEW PowerShell window** (to avoid cache restrictions) and run:

```powershell
npm install -g prisma
cd c:\pravidya\backend
prisma generate
prisma db push
```

### Option 2: Fix npm cache mode
Check for `.npmrc` file in your home directory (`C:\Users\Shruti\.npmrc`) and remove any `cache` or `fetch-retries` settings, then:

```powershell
cd c:\pravidya\backend
npm install prisma --save-dev
npm run prisma:generate
npm run prisma:push
```

### Option 3: Use yarn instead of npm
If npm continues to have issues:

```powershell
cd c:\pravidya\backend
yarn add -D prisma
yarn prisma generate
yarn prisma db push
```

## After Prisma is installed:

1. **Generate Prisma Client:**
   ```bash
   npm run prisma:generate
   ```

2. **Push schema to database:**
   ```bash
   npm run prisma:push
   ```
   This will create all tables in your Neon PostgreSQL database.

3. **Verify connection:**
   ```bash
   npm start
   ```
   You should see: "✅ PostgreSQL Connected via Prisma"

## Current Status:

✅ Prisma schema created: `prisma/schema.prisma`
✅ Prisma client instance: `prisma/client.js`
✅ Assignment engine migrated to Prisma
✅ Server.js updated for Prisma
✅ DATABASE_URL configured in .env

⏳ **Pending:** Generate Prisma Client and push schema to database

## Your DATABASE_URL:
```
postgresql://neondb_owner:npg_qf3HJDExU6GM@ep-gentle-credit-ah2vnt68-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Once Prisma CLI is installed and you run `prisma db push`, all your tables will be created in the Neon database.
