import { Router } from "express"
import authController from "@/controllers/authControllers.js"

const router: Router = Router()

router.post("/signup", authController.signup)
router.post("/login", authController.login)
router.post("/forgot-password", authController.forgotPassword)
router.post("/verify-otp", authController.verifyOTP)
router.post("/change-password", authController.changePassword)

export default router
