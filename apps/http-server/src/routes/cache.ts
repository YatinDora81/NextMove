import express, { Router } from 'express';
import CacheController from '@/controllers/cacheController.js';
import { authenticateUser } from '@/middleware/authenticateUser.js';
import { isAdmin } from '@/middleware/isAdmin.js';

const router: Router = express.Router()

router.delete('/clear-all-cache', authenticateUser, isAdmin, CacheController.clearAllCache)

export default router;