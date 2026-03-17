import express from 'express';
import authRoutes from './auth.js';
import institutionRoutes from './institutions.js';
import staffRoutes from './staff.js';
import dashboardRoutes from './dashboard.js';
import { authenticateSuperAdmin } from '../../middleware/superAdminAuth.js';

const router = express.Router();

// Public auth routes
router.use('/auth', authRoutes);

// All other routes require Super Admin auth
router.use(authenticateSuperAdmin);
router.use('/institutions', institutionRoutes);
router.use('/staff', staffRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
