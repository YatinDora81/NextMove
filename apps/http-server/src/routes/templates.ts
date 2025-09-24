import express, { Request, Response, Router } from 'express'
import Templates from '@/src/controllers/templateControllers.js'
const router: Router = express.Router()

router.get('/get-templates', Templates.getTemplates)

router.post('/add-template', (req: Request, res: Response) => {
    try {

    } catch (error) {

    }
})

router.put('/update-template', (req: Request, res: Response) => {
    try {

    } catch (error) {

    }
})

router.delete('/delete-template', (req: Request, res: Response) => {
    try {

    } catch (error) {

    }
})

export default router;