// import express from 'express';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { prisma } from '../prismaClient.js';

// // Routes
// import authRoutes from '../routes/auth.js';
// import leadRoutes from '../routes/leads.js';
// import counselorRoutes from '../routes/counselors.js';
// import adminRoutes from '../routes/admin.js';
// import institutionRoutes from '../routes/institutions.js';
// import courseRoutes from '../routes/courses.js';
// import sessionRoutes from '../routes/sessions.js';
// import trainingRoutes from '../routes/training.js';
// import todoRoutes from '../routes/todos.js';
// import schoolRoutes from '../routes/schools.js';
// import presenceRoutes from '../routes/presence.js';
// import trainingModuleRoutes from '../routes/trainingModules.js';
// import questionRoutes from '../routes/questions.js';
// import managementRoutes from '../routes/management.js';
// import externalRoutes from '../routes/external.js';

// import { errorHandler } from '../middleware/errorHandler.js';

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();

// app.use(cors());
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Static files
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// app.use('/media', express.static(path.join(__dirname, '../media')));

// // Health
// app.get('/api/health', (req, res) => {
//   res.json({ success: true, message: 'Backend running 🚀' });
// });

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/leads', leadRoutes);
// app.use('/api/counselors', counselorRoutes);
// app.use('/api/admin', adminRoutes);
// app.use('/api/institutions', institutionRoutes);
// app.use('/api/courses', courseRoutes);
// app.use('/api/sessions', sessionRoutes);
// app.use('/api/training', trainingRoutes);
// app.use('/api/todos', todoRoutes);
// app.use('/api/schools', schoolRoutes);
// app.use('/api/presence', presenceRoutes);
// app.use('/api/training-modules', trainingModuleRoutes);
// app.use('/api/questions', questionRoutes);
// app.use('/api/management', managementRoutes);
// app.use('/api/external', externalRoutes);

// // 404
// app.use((req, res) => {
//   res.status(404).json({ success: false, message: 'Route not found' });
// });

// app.use(errorHandler);

// // Prisma connection
// prisma.$connect()
//   .then(() => console.log("DB connected"))
//   .catch(e => console.log("DB error", e));

// export default app;


import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../prismaClient.js";

// Routes
import authRoutes from "../routes/auth.js";
import leadRoutes from "../routes/leads.js";
import counselorRoutes from "../routes/counselors.js";
import adminRoutes from "../routes/admin.js";
import institutionRoutes from "../routes/institutions.js";
import courseRoutes from "../routes/courses.js";
import sessionRoutes from "../routes/sessions.js";
import trainingRoutes from "../routes/training.js";
import todoRoutes from "../routes/todos.js";
import schoolRoutes from "../routes/schools.js";
import presenceRoutes from "../routes/presence.js";
import trainingModuleRoutes from "../routes/trainingModules.js";
import questionRoutes from "../routes/questions.js";
import managementRoutes from "../routes/management.js";
import externalRoutes from "../routes/external.js";

import { errorHandler } from "../middleware/errorHandler.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------- MIDDLEWARE ---------------- */

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- STATIC FILES ---------------- */

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use("/media", express.static(path.join(__dirname, "../media")));

/* ---------------- HEALTH CHECK ---------------- */

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, message: "Backend running 🚀" });
  } catch (err) {
    res.status(500).json({ success: false, message: "DB connection failed" });
  }
});

/* ---------------- ROUTES ---------------- */

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

/* ---------------- ROOT ---------------- */

app.get("/", (req, res) => {
  res.send("Pravidya Backend Live 🚀");
});

/* ---------------- 404 ---------------- */

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

/* ---------------- ERROR HANDLER ---------------- */

app.use(errorHandler);

/* ❗ DO NOT USE app.listen() */
/* ❗ DO NOT USE prisma.$connect() */
/* Vercel handles execution */

export default app;
