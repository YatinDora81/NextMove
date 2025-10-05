import generatedMessageControllers from "@/controllers/generatedMessageControllers.js";
import { authenticateUser } from "@/middleware/authenticateUser.js";
import { Router } from "express";
const router: Router = Router();

router.get('/get-generated-messages', authenticateUser, generatedMessageControllers.getGeneratedMessages)
router.post('/generate-message', authenticateUser, generatedMessageControllers.generateMessage)

export default router;