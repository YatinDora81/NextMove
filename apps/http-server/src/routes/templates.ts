import express, { Request, Response, Router } from 'express'
import Templates from '../controllers/templateControllers.js'
const router: Router = express.Router()

router.get('/get-templates', Templates.getTemplates)

router.post('/add-template', Templates.createTemplate)

router.put('/update-template', Templates.updateTemplate)

router.delete('/delete-template', Templates.deleteTemplate)

export default router;