import express, { Request, Response, Router } from 'express'
import Templates from '../controllers/templateControllers.js'
import { authenticateUser } from '@/middleware/authenticateUser.js'
const router: Router = express.Router()

router.get('/get-templates', authenticateUser, Templates.getTemplates)

router.post('/add-template', authenticateUser, Templates.createTemplate)

router.put('/update-template', authenticateUser, Templates.updateTemplate)

router.delete('/delete-template', authenticateUser, Templates.deleteTemplate)

export default router;