import chatControllers from '@/controllers/chatControllers.js';
import { authenticateUser } from '@/middleware/authenticateUser.js';
import { isPremium } from '@/middleware/isPremium.js';
import { Router } from 'express'
const router: Router = Router()

router.get('/get-all-chats', authenticateUser, isPremium, chatControllers.getAllChats)
router.post('/create-chat', authenticateUser, isPremium, chatControllers.createChat)

export default router;