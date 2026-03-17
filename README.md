# Admissions Platform - Backend API

Production-ready MERN stack backend for an intelligent admissions management platform with automatic counselor assignment.

## 🚀 Features

- **Public Admission Form**: Accept parent submissions without authentication
- **Automatic Counselor Assignment**: Intelligent matching based on expertise, language, and availability
- **Role-Based Access Control**: Admin and Counselor roles with JWT authentication
- **Lead Management**: Complete CRUD operations with filtering and search
- **Counselor Management**: Create, update, and manage counselor profiles
- **Institution & Course Management**: Manage schools, colleges, and programs
- **Counseling Sessions**: Schedule and manage student counseling sessions
- **Training Content**: Upload and manage training materials for counselors
- **Activity Logging**: Comprehensive audit trail for all admin actions
- **Analytics Dashboard**: Statistics and performance metrics

## 📋 Prerequisites

- Node.js (v16 or higher)
- MongoDB (v5 or higher)
- npm or yarn

## 🛠️ Installation

1. **Clone the repository and navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` file**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables in `.env`**
   ```env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/admissions_db
   JWT_SECRET=your_super_secret_jwt_key_change_in_production
   JWT_EXPIRE=7d
   NODE_ENV=development
   ```

5. **Start MongoDB**
   - Make sure MongoDB is running on your system
   - Default connection: `mongodb://localhost:27017`

6. **Seed the database (optional)**
   ```bash
   npm run seed
   ```
   This will create:
   - Admin user (username: `admin`, password: `admin123`)
   - Sample counselors
   - Sample institutions and courses
   - Sample institutions and courses

7. **Start the development server**
   ```bash
   npm run dev
   ```
   Or for production:
   ```bash
   npm start
   ```

The server will run on `http://localhost:8000`

## 📁 Project Structure

```
backend/
├── models/              # Mongoose schemas
│   ├── User.js
│   ├── CounselorProfile.js
│   ├── Lead.js
│   ├── Institution.js
│   ├── Course.js
│   ├── CounselingSession.js
│   ├── TrainingContent.js
│   ├── Todo.js
│   └── ActivityLog.js
├── routes/              # API route handlers
│   ├── auth.js
│   ├── leads.js
│   ├── counselors.js
│   ├── institutions.js
│   ├── courses.js
│   ├── sessions.js
│   ├── training.js
│   ├── todos.js
│   └── admin.js
├── middleware/          # Express middleware
│   ├── auth.js
│   ├── errorHandler.js
│   └── asyncHandler.js
├── services/            # Business logic
│   └── assignmentEngine.js
├── utils/               # Utility functions
│   └── jwt.js
├── scripts/             # Utility scripts
│   └── seed.js
├── uploads/             # File uploads directory
│   └── training/
├── server.js            # Main server file
├── package.json
└── .env                 # Environment variables
```

## 🔐 Authentication

### Login Endpoint
```
POST /api/auth/login
Body: {
  "username": "admin",
  "password": "admin123"
}
```

### Protected Routes
Include the JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/change-password` - Change password

### Leads (Public & Protected)
- `POST /api/leads` - Create lead (Public)
- `GET /api/leads` - Get all leads (Admin only)
- `GET /api/leads/:id` - Get single lead
- `PUT /api/leads/:id` - Update lead
- `POST /api/leads/:id/assign` - Manually assign counselor (Admin)
- `GET /api/leads/stats/overview` - Get lead statistics (Admin)

### Counselors
- `GET /api/counselors` - Get all counselors (Admin)
- `GET /api/counselors/:id` - Get single counselor
- `POST /api/counselors` - Create counselor (Admin)
- `PUT /api/counselors/:id` - Update counselor (Admin)
- `GET /api/counselors/:id/leads` - Get assigned leads
- `GET /api/counselors/:id/stats` - Get counselor statistics

### Institutions
- `GET /api/institutions` - Get all institutions (Public)
- `GET /api/institutions/:id` - Get single institution (Public)
- `POST /api/institutions` - Create institution (Admin)
- `PUT /api/institutions/:id` - Update institution (Admin)
- `DELETE /api/institutions/:id` - Delete institution (Admin)

### Courses
- `GET /api/courses` - Get all courses (Public)
- `GET /api/courses/:id` - Get single course (Public)
- `POST /api/courses` - Create course (Admin)
- `PUT /api/courses/:id` - Update course (Admin)
- `DELETE /api/courses/:id` - Delete course (Admin)

### Counseling Sessions
- `GET /api/sessions` - Get all sessions
- `GET /api/sessions/:id` - Get single session
- `POST /api/sessions` - Create session
- `PUT /api/sessions/:id` - Update session

### Training Content
- `GET /api/training` - Get all training content
- `GET /api/training/:id` - Get single training content
- `POST /api/training` - Create training content (Admin, with file upload)
- `PUT /api/training/:id` - Update training content (Admin)
- `DELETE /api/training/:id` - Delete training content (Admin)

### Todos
- `GET /api/todos` - Get all todos for current user
- `GET /api/todos/:id` - Get single todo
- `POST /api/todos` - Create todo
- `PUT /api/todos/:id` - Update todo
- `DELETE /api/todos/:id` - Delete todo

### Admin
- `GET /api/admin/dashboard` - Get dashboard statistics
- `GET /api/admin/activity-logs` - Get activity logs
- `POST /api/admin/users` - Create user (Admin)

## 🧠 Automatic Counselor Assignment Logic

The system automatically assigns leads to counselors based on:

1. **Expertise Match** (40 points): Counselor's expertise matches the selected course
2. **Language Match** (30 points): Counselor speaks the parent's preferred language
3. **Availability** (Required): Counselor must be ACTIVE
4. **Load Capacity** (20 points): Counselor's current load vs max capacity
5. **Current Load** (10 points): Bonus for counselors with no current load

**Scoring System:**
- Highest score wins
- If scores are equal, counselor with lower load percentage is selected
- If no match found, assigns to default counselor (lowest load)

**Fallback:**
- If no active counselors available, assigns to first available counselor
- System ensures no lead is left unassigned

## 🔒 Role-Based Access Control

### Admin
- Full access to all endpoints
- Can create/manage counselors
- Can reassign leads
- Can manage institutions and courses
- Can upload training content
- Can view all leads and analytics

### Counselor
- Can view only assigned leads
- Can update lead status and notes
- Can create/update counseling sessions
- Can access training content
- Can manage personal todos
- Cannot view other counselors' leads
- Cannot modify institution/course data

## 📊 Database Models

### User
- Authentication credentials
- Role (ADMIN/COUNSELOR)
- Link to CounselorProfile (if counselor)

### CounselorProfile
- Personal information
- Expertise array
- Languages array
- Availability status
- Load capacity and current load

### Lead
- Parent and student details
- Admission preferences
- Classification and priority
- Assignment information (counselor, auto/manual flag)
- Status tracking

### Institution
- School/College information
- Associated courses

### Course
- Course details
- Institution reference
- Eligibility and duration

### CounselingSession
- Scheduled sessions
- Status tracking
- Remarks and follow-ups

### TrainingContent
- Training materials (videos, documents, links)
- Upload tracking
- View counts

### Todo
- Personal task management
- Priority and status

### ActivityLog
- Audit trail
- User actions tracking
- Entity changes

## 🧪 Testing

### Sample API Calls

**1. Create Lead (Public)**
```bash
curl -X POST http://localhost:8000/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "parentName": "John Doe",
    "parentMobile": "9876543210",
    "parentEmail": "john@example.com",
    "parentCity": "Bangalore",
    "preferredLanguage": "English",
    "studentName": "Jane Doe",
    "dateOfBirth": "2005-06-15",
    "gender": "Female",
    "currentClass": "12th",
    "boardUniversity": "CBSE",
    "marksPercentage": 85,
    "institution": "<institution_id>",
    "course": "<course_id>",
    "academicYear": "2024-2025",
    "preferredCounselingMode": "Online",
    "notes": "Interested in admission",
    "consent": true
  }'
```

**2. Login**
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

**3. Get All Leads (Admin)**
```bash
curl -X GET http://localhost:8000/api/leads \
  -H "Authorization: Bearer <token>"
```

## 🐛 Error Handling

All errors are handled centrally through the error handler middleware. Responses follow this format:

```json
{
  "success": false,
  "message": "Error message",
  "errors": [] // Validation errors if any
}
```

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 5000 |
| MONGODB_URI | MongoDB connection string | mongodb://localhost:27017/admissions_db |
| JWT_SECRET | Secret key for JWT tokens | (required) |
| JWT_EXPIRE | JWT token expiration | 7d |
| NODE_ENV | Environment mode | development |

## 🔧 Development

### Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run seed` - Seed database with sample data

### File Uploads
Training content files are stored in `uploads/training/` directory. Make sure this directory exists and has write permissions.

## 🚨 Security Notes

1. **Change JWT_SECRET** in production
2. **Use strong passwords** for admin accounts
3. **Enable HTTPS** in production
4. **Validate file uploads** (already implemented)
5. **Rate limiting** recommended for production
6. **Input validation** on all endpoints (already implemented)

## 🚀 Deploy to Hostinger

The backend is **ready to deploy** with Hostinger’s default Node.js build (no custom build command needed).

1. **Zip the backend**  
   From the repo root, zip the contents of `pravidya/backend/` (do **not** include `node_modules` or `.env`).

2. **Upload** the zip in Hostinger → Node.js app, set **Root directory** to `backend`, **Entry file** to `server.js`, Node 22.x.

3. **Configure** environment variables in the Hostinger panel (same keys as in `.env.example`).

4. **Deploy** — Hostinger will run `npm install` and `npm run build`; the build script fixes Prisma binary permissions and runs `prisma generate` automatically.

## 📄 License

ISC

## 👥 Support

For issues or questions, please refer to the project documentation or contact the development team.
