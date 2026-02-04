# MongoDB to PostgreSQL Migration Guide

This document outlines the migration from MongoDB (Mongoose) to PostgreSQL (Prisma ORM) for the Admissions Platform backend.

## ✅ Completed Steps

### 1. Prisma Schema Created
- **File**: `prisma/schema.prisma`
- All models migrated: User, CounselorProfile, Lead, Institution, Course, CounselingSession, TrainingContent, Todo, ActivityLog
- All relations properly defined
- Enums created for all enum fields
- Indexes maintained for performance

### 2. Package Dependencies Updated
- **File**: `package.json`
- Added: `@prisma/client` and `prisma` (dev)
- Removed: `mongoose`
- Added Prisma scripts: `prisma:generate`, `prisma:migrate`, `prisma:studio`, `prisma:push`

### 3. Prisma Client Instance
- **File**: `prisma/client.js`
- Singleton pattern for Prisma client
- Prevents multiple instances in development

### 4. Assignment Engine Migrated
- **File**: `services/assignmentEngine.js`
- All Mongoose queries replaced with Prisma
- Transactions used for atomic operations
- Business logic preserved exactly

### 5. Server Updated
- **File**: `server.js`
- Removed MongoDB connection
- Added Prisma connection with error handling
- Graceful shutdown implemented

### 6. Environment Configuration
- **File**: `.env.example`
- Updated with `DATABASE_URL` for PostgreSQL
- Neon-compatible format with `sslmode=require`

### 7. Git Configuration
- **File**: `.gitignore`
- Added Prisma migrations exclusion

## 📋 Next Steps Required

### Step 1: Install Dependencies
```bash
cd backend
npm install
```

### Step 2: Generate Prisma Client
```bash
npm run prisma:generate
```

### Step 3: Set Up Database
1. Create a PostgreSQL database (Neon or local)
2. Update `.env` with your `DATABASE_URL`:
   ```
   DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
   ```

### Step 4: Run Migrations
```bash
# For development (creates migration files)
npm run prisma:migrate

# OR for quick prototyping (pushes schema directly)
npm run prisma:push
```

### Step 5: Update All Route Files

The following route files need to be updated to use Prisma instead of Mongoose:

#### Files to Update:
1. `routes/auth.js` - User authentication
2. `routes/leads.js` - Lead management
3. `routes/counselors.js` - Counselor management
4. `routes/institutions.js` - Institution CRUD
5. `routes/courses.js` - Course CRUD
6. `routes/sessions.js` - Counseling sessions
7. `routes/training.js` - Training content
8. `routes/todos.js` - Todo management
9. `routes/admin.js` - Admin operations

#### Common Migration Patterns:

**Mongoose → Prisma Examples:**

```javascript
// OLD (Mongoose)
const user = await User.findById(id);
const users = await User.find({ role: 'ADMIN' });
const newUser = new User(data);
await newUser.save();

// NEW (Prisma)
const user = await prisma.user.findUnique({ where: { id } });
const users = await prisma.user.findMany({ where: { role: 'ADMIN' } });
const newUser = await prisma.user.create({ data });
```

**Populate → Include:**
```javascript
// OLD (Mongoose)
const lead = await Lead.findById(id).populate('assignedCounselor');

// NEW (Prisma)
const lead = await prisma.lead.findUnique({
  where: { id },
  include: { assignedCounselor: true }
});
```

**Updates:**
```javascript
// OLD (Mongoose)
lead.status = 'CONTACTED';
await lead.save();

// NEW (Prisma)
const updatedLead = await prisma.lead.update({
  where: { id: lead.id },
  data: { status: 'CONTACTED' }
});
```

**Deletes:**
```javascript
// OLD (Mongoose)
await Lead.findByIdAndDelete(id);

// NEW (Prisma)
await prisma.lead.delete({ where: { id } });
```

**Transactions:**
```javascript
// OLD (Mongoose) - Manual transaction
const session = await mongoose.startSession();
session.startTransaction();
try {
  // operations
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
}

// NEW (Prisma) - Built-in transaction
await prisma.$transaction(async (tx) => {
  // operations using tx instead of prisma
});
```

### Step 6: Update Seed Script
- **File**: `scripts/seed.js`
- Replace all Mongoose operations with Prisma
- Use transactions for bulk inserts

### Step 7: Update Middleware (if needed)
- Check `middleware/auth.js` for any Mongoose usage
- Update to use Prisma if needed

### Step 8: Update Error Handler
- **File**: `middleware/errorHandler.js`
- Replace Mongoose error types with Prisma error types
- Prisma errors: `PrismaClientKnownRequestError`, `PrismaClientValidationError`, etc.

## 🔑 Key Differences

### ID Fields
- **Mongoose**: Uses `_id` (ObjectId)
- **Prisma**: Uses `id` (String/CUID by default)

### Relations
- **Mongoose**: Uses `populate()` for relations
- **Prisma**: Uses `include` or `select` in queries

### Arrays
- **Mongoose**: Native array support
- **Prisma**: Arrays work the same way for scalar arrays

### Timestamps
- **Mongoose**: Manual `createdAt`/`updatedAt`
- **Prisma**: `@default(now())` and `@updatedAt` decorators

### Enums
- **Mongoose**: String with enum validation
- **Prisma**: Native enum types in schema

## ⚠️ Important Notes

1. **Lead ID Generation**: The `leadId` field generation logic needs to be moved from Mongoose pre-save hook to application logic (before Prisma create).

2. **Password Hashing**: User password hashing should be done before Prisma create (not in a pre-save hook).

3. **Validation**: Use `express-validator` for request validation (already in place).

4. **Transactions**: Use Prisma transactions for operations that need atomicity (like assignment engine).

5. **Error Handling**: Prisma errors are different from Mongoose errors - update error handler accordingly.

## 🧪 Testing Checklist

After migration:
- [ ] User authentication (login)
- [ ] Lead creation and assignment
- [ ] Counselor assignment engine
- [ ] Lead reassignment
- [ ] All CRUD operations
- [ ] Relations and includes
- [ ] Transactions
- [ ] Error handling

## 📚 Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)
- [Prisma Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)
