# Fix Prisma Generate Network Error

## Current Error
```
Error: request to https://binaries.prisma.sh/... failed, reason: connect ECONNREFUSED 127.0.0.1:9
```

This indicates a **proxy or network configuration issue**. Port 9 is unusual and suggests a misconfigured proxy.

## Quick Fix: Counselor Login Works Now! ✅

**Good news:** I've added error handling so **counselor login will work** even without presence tracking. The login won't fail - it will just skip presence tracking.

## Solutions (Try in Order)

### Solution 1: Check Proxy Settings

The error `127.0.0.1:9` suggests a proxy issue. Check:

```powershell
# Check if proxy is set
echo $env:HTTP_PROXY
echo $env:HTTPS_PROXY

# If proxy is set incorrectly, unset it temporarily
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""

# Then try again
npm run prisma:generate
```

### Solution 2: Use Direct Internet Connection

1. **Disable VPN** if active
2. **Disable proxy** in Windows Settings
3. **Try mobile hotspot** to test if it's network-related
4. Then run: `npm run prisma:generate`

### Solution 3: Set Prisma Binary Cache Location

```powershell
# Set Prisma to use a local cache directory
$env:PRISMA_ENGINES_MIRROR = ""
$env:PRISMA_BINARY_CACHE_DIR = "$env:USERPROFILE\.prisma\engines"

# Try generate again
npm run prisma:generate
```

### Solution 4: Manual Binary Download (Advanced)

1. **Download Prisma binaries manually** from: https://github.com/prisma/prisma-engines/releases
2. **Extract to**: `node_modules\.prisma\client\`
3. **Then run**: `npm run prisma:generate`

### Solution 5: Use Different Network

Try from:
- Different WiFi network
- Mobile hotspot
- Different location

## Temporary Workaround: Login Works Without Presence

**The counselor login will work now** because I've added error handling. Presence tracking will be skipped, but login succeeds.

**To test:**
1. Start backend: `npm start`
2. Go to: `http://localhost:3000/counselor/login`
3. Login should work!

**Presence tracking will be added** once Prisma is regenerated.

## Verify Current State

Run this to check what's available:
```bash
cd backend
node test-prisma-client.js
```

You'll see which models are available. Currently missing:
- ❌ `counselorPresence`
- ❌ `dailyAttendance`

## After Fixing Network Issue

Once you can run `npm run prisma:generate` successfully:

1. **Regenerate Prisma:**
   ```bash
   npm run prisma:generate
   ```

2. **Verify:**
   ```bash
   node test-prisma-client.js
   ```
   Should show: `✅ prisma.counselorPresence is available`

3. **Restart backend:**
   ```bash
   npm start
   ```

4. **Test counselor login** - presence tracking will now work!

## Most Likely Fix

**Check Windows proxy settings:**
1. Open **Settings** → **Network & Internet** → **Proxy**
2. If "Use a proxy server" is ON, turn it OFF temporarily
3. Or configure it correctly with proper proxy address
4. Then try `npm run prisma:generate` again
