# Quick Setup Guide

## Prerequisites
- Node.js v16+ installed
- MongoDB running locally or accessible remotely

## Installation Steps

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `MONGODB_URI` - Your MongoDB connection string
   - `JWT_SECRET` - A strong secret key for JWT tokens

3. **Seed database (optional)**
   ```bash
   npm run seed
   ```
   This creates:
   - Admin user: `admin` / `admin123`
   - 4 sample counselors: `counselor1-4` / `counselor123`
   - Sample institutions and courses
   - Sample leads

4. **Start server**
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:5000`

## Verify Installation

1. Check health endpoint:
   ```bash
   curl http://localhost:5000/api/health
   ```

2. Test login:
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```

## API Base URL
```
http://localhost:5000/api
```

## Next Steps
- Review `README.md` for complete API documentation
- Test the public lead submission endpoint
- Explore admin dashboard endpoints
- Set up frontend to connect to this backend
