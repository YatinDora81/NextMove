import express, { Request, Response, Router } from 'express'
import userControllers from '../controllers/userControllers.js'
const router: Router = express.Router()

router.post('/create-user', userControllers.createUser)

export default router