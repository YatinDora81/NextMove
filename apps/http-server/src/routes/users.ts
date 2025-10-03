import express, { Request, Response, Router } from 'express'
import userControllers from '../controllers/userControllers.js'
import { authenticateUser } from '@/middleware/authenticateUser.js'
const router: Router = express.Router()

router.post('/create-user', authenticateUser, userControllers.createUser)

export default router