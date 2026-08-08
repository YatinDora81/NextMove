import aiKeyControllers from '@/controllers/aiKeyControllers.js';
import { authenticateUser } from '@/middleware/authenticateUser.js';
import { Router } from 'express'

/**
 * JF-001 SEC 15.5 / SPINE 2.10 — the write-only key vault, mounted at `/api/ai-keys`.
 *
 *   POST   /api/ai-keys           JWT   add + live-validate + seal
 *   GET    /api/ai-keys           JWT   masked list (id, label, last4, status, lastUsedAt)
 *   POST   /api/ai-keys/:id/test  JWT   re-validate, flip DEAD ↔ ACTIVE
 *   DELETE /api/ai-keys/:id       JWT   hard delete
 *
 * Every route is behind `authenticateUser` and every query is scoped by `req.user.user_id`, so a
 * guessed row id from another tenant resolves to nothing.
 *
 * There is deliberately **no** `GET /api/ai-keys/:id` and no reveal route: the vault is write-only,
 * and adding a read path here would defeat the entire section (SEC 15.5 / 15.8). `isPremium` is
 * equally deliberate by its absence — this vault exists precisely for the users who are *not*
 * premium (SEC 15.1 lane 2).
 */
const router: Router = Router()

router.post('/', authenticateUser, aiKeyControllers.addKey)
router.get('/', authenticateUser, aiKeyControllers.listKeys)
router.post('/:id/test', authenticateUser, aiKeyControllers.testKey)
router.delete('/:id', authenticateUser, aiKeyControllers.deleteKey)

export default router;
