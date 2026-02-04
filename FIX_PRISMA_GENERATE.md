# Fix Prisma Generate Permission Error

## Problem
```
EPERM: operation not permitted, rename '...query_engine-windows.dll.node'
```

This happens because the Prisma query engine file is **locked by a running process** (usually the backend server).

## Solution

### Step 1: Stop All Node Processes

**Option A: Stop backend server manually**
- Find the terminal running `npm start` or `node server.js`
- Press `Ctrl+C` to stop it
- Wait a few seconds for it to fully stop

**Option B: Kill all Node processes (if server won't stop)**
```powershell
# Find Node processes
Get-Process node -ErrorAction SilentlyContinue

# Kill all Node processes (WARNING: closes ALL Node apps)
Stop-Process -Name node -Force
```

### Step 2: Close Any Other Programs Using Prisma

Close:
- VS Code/Cursor (if it has Prisma extension running)
- Any other terminals running Node
- Database tools that might be connected

### Step 3: Regenerate Prisma

```bash
cd backend
npm run prisma:generate
```

### Step 4: Restart Backend

```bash
npm start
```

## Alternative: Generate Without Engine Update

If you still get permission errors, you can try generating without updating the engine:

```bash
cd backend
npx prisma generate --no-engine
```

But this might not work if the client files themselves are locked.

## Prevention

Always **stop the backend server** before running `prisma generate`.
