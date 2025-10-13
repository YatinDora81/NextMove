import express, { Request, Response, Router } from 'express'
import userControllers from '../controllers/userControllers.js'
import { authenticateUser } from '@/middleware/authenticateUser.js'
import { isAdmin } from '@/middleware/isAdmin.js'
const router: Router = express.Router()

router.post('/create-user', authenticateUser, userControllers.createUser)
router.post('/update-user-details', authenticateUser, userControllers.updateUserDetails)
router.get('/is_premium', authenticateUser, userControllers.isPremium)
router.post('/update-premium', authenticateUser, isAdmin, userControllers.updatePremium)
router.get('/users' , authenticateUser , isAdmin , userControllers.getUsers)
export default router