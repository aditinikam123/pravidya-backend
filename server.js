// import express from 'express';
// import http from 'http';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { prisma } from './prismaClient.js';

// // Import routes
// import authRoutes from './routes/auth.js';
// import leadRoutes from './routes/leads.js';
// import counselorRoutes from './routes/counselors.js';
// import adminRoutes from './routes/admin.js';
// import institutionRoutes from './routes/institutions.js';
// import courseRoutes from './routes/courses.js';
// import sessionRoutes from './routes/sessions.js';
// import trainingRoutes from './routes/training.js';
// import todoRoutes from './routes/todos.js';
// // Phase-1 new routes
// import schoolRoutes from './routes/schools.js';
// import presenceRoutes from './routes/presence.js';
// import trainingModuleRoutes from './routes/trainingModules.js';
// import questionRoutes from './routes/questions.js';
// import managementRoutes from './routes/management.js';
// import externalRoutes from './routes/external.js';

// // Import middleware
// import { errorHandler } from './middleware/errorHandler.js';

// // Load environment variables
// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Request logging (detect duplicate/spam API calls)
// app.use((req, res, next) => {
//   console.log('API HIT:', req.method, req.url);
//   next();
// });

// // Serve static files (uploads)
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// // Training media: files in media/training/; only file path in DB (no BLOB)
// app.use('/media', express.static(path.join(__dirname, 'media')));

// // Health check route
// app.get('/api/health', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Server is running',
//     timestamp: new Date().toISOString()
//   });
// });

// // API Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/leads', leadRoutes);
// app.use('/api/counselors', counselorRoutes);
// app.use('/api/admin', adminRoutes);
// app.use('/api/institutions', institutionRoutes);
// app.use('/api/courses', courseRoutes);
// app.use('/api/sessions', sessionRoutes);
// app.use('/api/training', trainingRoutes);
// app.use('/api/todos', todoRoutes);
// // Phase-1 new routes
// app.use('/api/schools', schoolRoutes);
// app.use('/api/presence', presenceRoutes);
// app.use('/api/training-modules', trainingModuleRoutes);
// app.use('/api/questions', questionRoutes);
// app.use('/api/management', managementRoutes);
// app.use('/api/external', externalRoutes);

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Route not found',
//     path: req.method + ' ' + req.originalUrl,
//     hint: 'If this is the lead import, ensure the backend was restarted after adding /api/leads/import/preview and /api/leads/import/execute routes.'
//   });
// });

// // Error handler (must be last)
// app.use(errorHandler);

// // Connect to PostgreSQL via Prisma
// const connectDB = async () => {
//   try {
//     if (!process.env.DATABASE_URL) {
//       console.error('❌ Error: DATABASE_URL is not defined in .env file');
//       console.error('Please create a .env file with DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require');
//       process.exit(1);
//     }

//     // Test connection
//     await prisma.$connect();
//     console.log('✅ PostgreSQL Connected via Prisma');
    
//     // Verify connection with a simple query
//     await prisma.$queryRaw`SELECT 1`;
//     console.log('✅ Database connection verified');
//   } catch (error) {
//     console.error('❌ PostgreSQL connection error:', error.message);
//     console.error('Make sure your DATABASE_URL is correct and the database is accessible');
//     console.error('For Neon, ensure sslmode=require is in your connection string');
//     process.exit(1);
//   }
// };

// // Start server with keep-alive (Neon connection stability)
// const PORT = process.env.PORT || 5000;

// const startServer = async () => {
//   await connectDB();

//   const tryStartServer = (port, maxAttempts = 5) => {
//     const server = http.createServer(app);
//     server.keepAliveTimeout = 65000;
//     server.headersTimeout = 66000;
//     server.listen(port, () => {
//       console.log(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${port}`);
//     });
//     server.on('error', (err) => {
//       if (err.code === 'EADDRINUSE') {
//         if (port < PORT + maxAttempts) {
//           console.log(`⚠️  Port ${port} is in use, trying port ${port + 1}...`);
//           tryStartServer(port + 1, maxAttempts);
//         } else {
//           console.error(`❌ Could not find an available port. Tried ports ${PORT} to ${PORT + maxAttempts}`);
//           console.error('Please stop the process using port 5000 or set a different PORT in .env file');
//           process.exit(1);
//         }
//       } else {
//         console.error('❌ Server error:', err);
//         process.exit(1);
//       }
//     });
//   };

//   tryStartServer(PORT);
// };

// // Graceful shutdown
// const gracefulShutdown = async () => {
//   console.log('Shutting down gracefully...');
//   await prisma.$disconnect();
//   process.exit(0);
// };

// // Handle unhandled promise rejections
// process.on('unhandledRejection', (err) => {
//   console.error('Unhandled Rejection:', err);
//   gracefulShutdown();
// });

// // Handle SIGTERM and SIGINT
// process.on('SIGTERM', gracefulShutdown);
// process.on('SIGINT', gracefulShutdown);

// startServer();

// export default app;


import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "./prismaClient.js";

// Routes
import authRoutes from "./routes/auth.js";
import leadRoutes from "./routes/leads.js";
import counselorRoutes from "./routes/counselors.js";
import adminRoutes from "./routes/admin.js";
import institutionRoutes from "./routes/institutions.js";
import courseRoutes from "./routes/courses.js";
import sessionRoutes from "./routes/sessions.js";
import trainingRoutes from "./routes/training.js";
import todoRoutes from "./routes/todos.js";
import schoolRoutes from "./routes/schools.js";
import presenceRoutes from "./routes/presence.js";
import trainingModuleRoutes from "./routes/trainingModules.js";
import questionRoutes from "./routes/questions.js";
import managementRoutes from "./routes/management.js";
import externalRoutes from "./routes/external.js";

import { errorHandler } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ CORS FIX
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/media", express.static(path.join(__dirname, "media")));

// Health Check
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, message: "Server is running" });
  } catch {
    res.status(500).json({ success: false, message: "DB connection failed" });
  }
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/counselors", counselorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/todos", todoRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/presence", presenceRoutes);
app.use("/api/training-modules", trainingModuleRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/external", externalRoutes);

// Root
app.get("/", (req, res) => {
  res.send("Pravidya Backend Live 🚀");
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorHandler);

export default app;
