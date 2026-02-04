# Quick Start Guide - Prisma + PostgreSQL

## Prerequisites

1. **Node.js** installed (v18+)
2. **PostgreSQL database** on Neon (already configured in `.env`)
3. **Prisma CLI** installed

## Step-by-Step Setup

### Step 1: Install Prisma CLI (if not already installed)

**Option A: Install globally (Recommended)**
```powershell
npm install -g prisma@5.19.1
```

**Option B: Use local version**
```powershell
cd c:\pravidya\backend
npm install
```

### Step 2: Generate Prisma Client

```powershell
cd c:\pravidya\backend
prisma generate
```

This creates the Prisma Client based on your schema.

### Step 3: Push Schema to Database

```powershell
prisma db push
```

This creates all tables in your Neon PostgreSQL database.

**Expected output:**
```
✔ Generated Prisma Client
✔ Pushed schema to database
```

### Step 4: Start the Server

```powershell
npm start
```

Or for development with auto-reload:
```powershell
npm run dev
```

**Expected output:**
```
✅ PostgreSQL Connected via Prisma
✅ Database connection verified
Server running in development mode on port 5000
```

## Verify Installation

1. **Check database connection:**
   - Visit: `http://localhost:5000/api/health`
   - Should return: `{"success": true, "message": "Server is running"}`

2. **Test API endpoints:**
   - All routes are available at: `http://localhost:5000/api/*`

## Troubleshooting

### If `prisma` command not found:
```powershell
# Install globally
npm install -g prisma@5.19.1

# Or use npx
npx prisma generate
npx prisma db push
```

### If database connection fails:
- Check `.env` file has correct `DATABASE_URL`
- Verify Neon database is accessible
- Ensure `sslmode=require` is in connection string

### If schema validation errors:
```powershell
# Format schema
prisma format

# Validate schema
prisma validate
```

## Common Commands

```powershell
# Generate Prisma Client
prisma generate

# Push schema to database (creates/updates tables)
prisma db push

# Create migration (for production)
prisma migrate dev --name init

# Open Prisma Studio (database GUI)
prisma studio

# Format schema
prisma format

# Validate schema
prisma validate
```

## Your Current Setup

✅ **Schema**: `prisma/schema.prisma` - All models defined
✅ **Client**: `prisma/client.js` - Prisma Client singleton
✅ **Database URL**: Configured in `.env`
✅ **Server**: `server.js` - Ready to connect

## Next Steps After Running

1. **Seed database** (optional):
   ```powershell
   npm run seed
   ```
   Note: You'll need to update `scripts/seed.js` to use Prisma instead of Mongoose

2. **Test the API**:
   - Use Postman or curl to test endpoints
   - Frontend should connect to `http://localhost:5000/api`

3. **Monitor logs**:
   - Check console for any errors
   - Prisma logs queries in development mode

## Environment Variables

Make sure your `.env` file contains:
```
PORT=5000
DATABASE_URL=postgresql://neondb_owner:npg_qf3HJDExU6GM@ep-gentle-credit-ah2vnt68-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=your_super_secret_jwt_key_change_in_production_min_32_chars
JWT_EXPIRE=7d
NODE_ENV=development
```
