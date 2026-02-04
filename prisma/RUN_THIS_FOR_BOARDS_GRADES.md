# Boards & Grades: Run this so they save and show

Boards and Grades on school cards show "—" until the database has the new columns.

## 1. Run the migration SQL

Run the SQL in **add_institution_school_and_course_fields.sql** against your PostgreSQL database.

**Option A – psql:**
```bash
cd backend
psql "YOUR_DATABASE_URL" -f prisma/add_institution_school_and_course_fields.sql
```

**Option B – Copy/paste in your DB client (pgAdmin, DBeaver, etc.):**
- Open `prisma/add_institution_school_and_course_fields.sql`
- Execute its contents on your database

## 2. Regenerate Prisma client

```bash
cd backend
npx prisma generate
```

## 3. Restart the backend server

Then:

- **Edit** the school again, set Boards and Grades, and **Save** — they will be stored and shown on the card.
- New schools created as type School will also save and show boards/grades.
