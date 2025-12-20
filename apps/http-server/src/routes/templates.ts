import express, { Request, Response, Router } from 'express'
import Templates from '../controllers/templateControllers.js'
import { authenticateUser } from '@/middleware/authenticateUser.js'
import { isAdmin } from '@/middleware/isAdmin.js'
import { isPremium } from '@/middleware/isPremium.js'
const router: Router = express.Router()

router.get('/get-templates', authenticateUser, Templates.getTemplates)

router.post('/add-template', authenticateUser, Templates.createTemplate)

router.put('/update-template', authenticateUser, Templates.updateTemplate)

router.delete('/delete-template', authenticateUser, Templates.deleteTemplate)

router.post('/add-template-bulk', authenticateUser, isAdmin, Templates.addTemplateBulk)

router.get('/get-common-templates', authenticateUser, Templates.getCommonTemplates)

router.post('/ai-generate-template', authenticateUser, isPremium, Templates.aiGenerateTemplate)

export default router;