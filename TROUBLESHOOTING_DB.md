# Database Connection Troubleshooting Guide

## Current Issue
**Error**: `Can't reach database server at ep-gentle-credit-ah2vnt68-pooler.c-3.us-east-1.aws.neon.tech:5432`

## Most Common Cause: Database is Paused

Neon databases **auto-pause** after a period of inactivity to save resources. This is the most common reason for connection failures.

### Solution: Wake Up Your Neon Database

1. **Log into Neon Console**
   - Go to: https://console.neon.tech
   - Sign in with your account

2. **Find Your Project**
   - Look for project: `ep-gentle-credit-ah2vnt68`
   - Or search for database: `neondb`

3. **Wake Up the Database**
   - Click on your project
   - If the database is paused, you'll see a "Resume" or "Wake Up" button
   - Click it to activate the database
   - Wait 10-30 seconds for it to fully start

4. **Get Fresh Connection String** (if needed)
   - In Neon console, go to your project
   - Click on "Connection Details" or "Connection String"
   - Copy the new connection string
   - Update your `.env` file with the new `DATABASE_URL`

## Other Possible Issues

### 1. Connection String Expired
- Neon connection strings can expire
- Get a fresh one from Neon console
- Update `.env` file

### 2. Network/Firewall Issues
- Check if your firewall is blocking port 5432
- Try from a different network
- Check if your ISP blocks database connections

### 3. Wrong Connection String Format
Your connection string should look like:
```
postgresql://username:password@host:port/database?sslmode=require
```

For Neon, try these variations:
- `sslmode=require` (most secure)
- `sslmode=prefer` (more lenient)
- `sslmode=allow` (least secure, not recommended)

### 4. Using Direct Connection Instead of Pooler
If pooler connection fails, try the direct connection endpoint:
- Pooler: `ep-gentle-credit-ah2vnt68-pooler.c-3.us-east-1.aws.neon.tech`
- Direct: `ep-gentle-credit-ah2vnt68.c-3.us-east-1.aws.neon.tech` (remove `-pooler`)

## Testing the Connection

Run the test script:
```powershell
cd C:\Users\aditi\OneDrive\Desktop\pravidya\pravidya\backend
node scripts/testConnection.js
```

## Quick Fix Steps

1. ✅ **Wake up database in Neon console** (most important!)
2. ✅ **Get fresh connection string from Neon**
3. ✅ **Update `.env` file with new connection string**
4. ✅ **Test connection**: `node scripts/testConnection.js`
5. ✅ **Run seed**: `npm run seed`

## Current Connection String Format

Your current `.env` has:
```
DATABASE_URL=postgresql://neondb_owner:npg_qf3HJDExU6GM@ep-gentle-credit-ah2vnt68-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=prefer
```

If this doesn't work after waking the database, get a fresh connection string from Neon console.

## Need Help?

If the database is awake and you still can't connect:
1. Check Neon status page: https://status.neon.tech
2. Verify your Neon account is active
3. Check if the project/database was deleted
4. Try creating a new database in Neon and update the connection string
