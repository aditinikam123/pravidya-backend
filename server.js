import './loadEnv.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { prisma } from './prismaClient.js';

// Import routes
import captchaRoutes from './routes/captcha.js';
import authRoutes from './routes/auth.js';
import pravidyaAcademyRoutes from './routes/pravidya/academy.js';
import pravidyaAuthRoutes from './routes/pravidya/auth.js';
import pravidyaLeadsRoutes from './routes/pravidya/leads.js';
import leadRoutes from './routes/leads.js';
import counselorRoutes from './routes/counselors.js';
import adminRoutes from './routes/admin.js';
import institutionRoutes from './routes/institutions.js';
import institutionMeRoutes from './routes/institutionMe.js';
import courseRoutes from './routes/courses.js';
import sessionRoutes from './routes/sessions.js';
import trainingRoutes from './routes/training.js';
import todoRoutes from './routes/todos.js';
import classesRoutes from './routes/classes.js';
// Phase-1 new routes
import schoolRoutes from './routes/schools.js';
import presenceRoutes from './routes/presence.js';
import trainingModuleRoutes from './routes/trainingModules.js';
import questionRoutes from './routes/questions.js';
import managementRoutes from './routes/management.js';
import externalRoutes from './routes/external.js';
import counselorChatbotRoutes from './routes/counselorChatbot.js';
import counselorMeetLinkRoutes from './routes/counselorMeetLink.js';
import counselorVoiceCallRoutes from './routes/counselorVoiceCall.js';
import historicalFilesRoutes from './routes/historicalFiles.js';
import historicalAdmissionsRoutes from './routes/historicalAdmissions.js';
import historicalMarketingRoutes from './routes/historicalMarketing.js';
import historicalAnalyticsRoutes from './routes/historicalAnalytics.js';
import historicalVerificationRoutes from './routes/historicalVerification.js';
import intelligenceRoutes from './routes/intelligence.js';
import feedbackRoutes from './routes/feedback.js';
import formConfigRoutes from './routes/formConfig.js';
import saasAcademyRoutes from './routes/saasAcademy.js';
import jeetofyOnboardingRoutes from './routes/jeetofyOnboarding.js';
import webhookWhatsAppRoutes from './routes/webhookWhatsApp.js';
import superAdminRoutes from './routes/superAdmin/index.js';
import googleCalendarRoutes from './routes/googleCalendarRoutes.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// WhatsApp webhook must receive raw body for signature verification (mount before express.json)
app.use('/api/webhook/whatsapp', express.raw({ type: 'application/json' }), webhookWhatsAppRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (detect duplicate/spam API calls)
app.use((req, res, next) => {
  console.log('API HIT:', req.method, req.url);
  next();
});

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Training media: files in media/training/; only file path in DB (no BLOB)
app.use('/media', express.static(path.join(__dirname, 'media')));

// Health check routes
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend running'
  });
});

// Application health (no DB hit)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Database health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'OK',
      database: 'connected'
    });
  } catch (err) {
    console.error('Database health check failed:', err.message || err);
    res.status(500).json({
      status: 'ERROR',
      database: 'unreachable',
      message: err.message || 'Database connection failed'
    });
  }
});

// API Routes
app.use('/api/auth', captchaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/academy', pravidyaAcademyRoutes);
app.use('/api/pravidya/auth', pravidyaAuthRoutes);
app.use('/api/pravidya/leads', pravidyaLeadsRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/counselors/voice-call', counselorVoiceCallRoutes);
app.use('/api/counselors', counselorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/institution', institutionMeRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/classes', classesRoutes);
// Phase-1 new routes
app.use('/api/schools', schoolRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/training-modules', trainingModuleRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/management', managementRoutes);
app.use('/api/external', externalRoutes);
app.use('/api/counselor', counselorMeetLinkRoutes);
app.use('/api/counselor', counselorChatbotRoutes);
app.use('/api/historical-files', historicalFilesRoutes);
app.use('/api/historical-admissions', historicalAdmissionsRoutes);
app.use('/api/historical-marketing', historicalMarketingRoutes);
app.use('/api/historical-analytics', historicalAnalyticsRoutes);
app.use('/api/historical', historicalVerificationRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/saas', saasAcademyRoutes);
// Jeetofy SaaS onboarding + login (extension only)
app.use('/api', jeetofyOnboardingRoutes);
// Dynamic lead form configuration
app.use('/api/form-config', formConfigRoutes);
// Google Calendar routes
app.use('/calendar', googleCalendarRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.method + ' ' + req.originalUrl,
    hint: 'Ensure the backend was restarted after adding new routes (e.g. DELETE /api/sessions/:id, lead import).'
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Connect to PostgreSQL via Prisma (retry once after 2s if Neon is waking)
const connectDB = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not defined in environment variables');
    console.error(
      'Please configure DATABASE_URL in your .env file or hosting control panel (e.g. Neon connection string with sslmode=require).'
    );
    return;
  }

  const tryConnect = async () => {
    await prisma.$connect();
    console.log('✅ PostgreSQL Connected via Prisma');
  };

  try {
    await tryConnect();
    
    // Verify connection with a simple query
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection verified');

    // Ensure Historical Admissions tables exist (fix "column status does not exist" on startup)
    const { ensureHistoricalAdmissionsSchema } = await import('./scripts/ensureHistoricalAdmissionsSchema.js');
    await ensureHistoricalAdmissionsSchema();

    // Pravidya: run seed on every startup (upserts admin, management, 3 counselors from backend/.env)
    try {
      const { runPravidyaSeed } = await import('./scripts/seedPravidyaAcademy.js');
      await runPravidyaSeed();
      console.log('✅ PRAVIDYA seed synced. Login: /pravidya/acme/veeman/login');
    } catch (seedErr) {
      console.error('❌ PRAVIDYA seed failed:', seedErr.message);
    }
  } catch (error) {
    const isUnreachable = /can't reach|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(error.message || '');
    if (isUnreachable) {
      console.warn('⚠️ First connection attempt failed, retrying in 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await tryConnect();
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Database connection verified');
        const { ensureHistoricalAdmissionsSchema } = await import('./scripts/ensureHistoricalAdmissionsSchema.js');
        await ensureHistoricalAdmissionsSchema();
        try {
          const { runPravidyaSeed } = await import('./scripts/seedPravidyaAcademy.js');
          await runPravidyaSeed();
          console.log('✅ PRAVIDYA seed synced. Login: /pravidya/acme/veeman/login');
        } catch (seedErr) {
          console.error('❌ PRAVIDYA seed failed:', seedErr.message);
        }
        return;
      } catch (retryErr) {
        console.error('❌ PostgreSQL connection error (after retry):', retryErr.message);
      }
    } else {
      console.error('❌ PostgreSQL connection error:', error.message);
    }
    console.error('Make sure your DATABASE_URL is correct and the database is accessible');
    console.error('For Neon, ensure sslmode=require is in your connection string');
  }
};

// Start server with keep-alive (Neon connection stability)
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
  } catch (err) {
    console.error('❌ Failed to initialize database connection:', err);
  }

  const server = app.listen(PORT, () => {
    console.log(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. The Pravidya backend is configured to run only on this port.`);
      console.error('Please stop the process using this port or change PORT in the .env file.');
    } else {
      console.error('❌ Server error:', err);
    }
  });

  // Auto-send parent feedback form 3 hours after counseling completed (every 5 min)
  const { runFeedbackAutoSend } = await import('./services/feedbackAutoSend.js');
  setInterval(() => runFeedbackAutoSend().catch((e) => console.warn('[feedbackAutoSend]', e.message)), 5 * 60 * 1000);

  // Session NOT_CONNECTED handling: mark overdue sessions, create retries (every 5 min)
  const { runSessionNotConnectedJob } = await import('./jobs/sessionNotConnectedCron.js');
  setInterval(
    () =>
      runSessionNotConnectedJob()
        .then((r) => {
          if (r.processed > 0) console.log('[sessionNotConnected]', r);
        })
        .catch((e) => console.warn('[sessionNotConnected]', e.message)),
    5 * 60 * 1000
  );

  // Automated lead monitoring + alerts + reassignment (every 10 min)
  const { runLeadMonitoringJob } = await import('./jobs/leadMonitoringCron.js');
  // Run once shortly after startup, then every 10 minutes
  setTimeout(() => runLeadMonitoringJob().catch((e) => console.warn('[leadMonitoring]', e.message)), 30 * 1000);
  setInterval(
    () =>
      runLeadMonitoringJob()
        .then((r) => {
          if ((r.unattended || 0) > 0 || (r.inactiveCounselors || 0) > 0 || (r.reassigned || 0) > 0) {
            console.log('[leadMonitoring]', r);
          }
        })
        .catch((e) => console.warn('[leadMonitoring]', e.message)),
    10 * 60 * 1000
  );
};

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  gracefulShutdown();
});

// Handle SIGTERM and SIGINT
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();

export default app;
