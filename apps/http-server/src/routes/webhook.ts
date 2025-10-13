import { Router , Request , Response } from "express";

const router: Router = Router()

router.post('/clerk', (req: Request, res: Response) => {
    console.log(req.body)
    res.status(200).json({ message: 'Webhook received' })
})

export default router