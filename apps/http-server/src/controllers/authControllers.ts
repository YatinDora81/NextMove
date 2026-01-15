import { Request, Response } from "express"
import authRepo from "@/repository/authRepo.js"
import logger from "@/config/logger.js"
import jwt from "jsonwebtoken"
import { 
    signUpSchema, 
    signInSchema, 
    forgotPasswordSchema, 
    verifyOtpSchema, 
    changePasswordSchema 
} from "@repo/types/ZodTypes"

// Generate 6-digit OTP
function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
}

// Generate JWT token
function generateToken(user: { id: string; email: string; firstName: string; lastName: string | null }): string {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured in environment variables")
    }
    
    const payload = {
        user_id: user.id,
        email: user.email,
        full_name: `${user.firstName} ${user.lastName || ""}`.trim(),
        // Add other fields expected by authTokenSchema
        azp: "nextmove",
        iss: "nextmove",
        sub: user.id,
        image_url: "",
        phone_number: null,
    }
    
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" })
}

// Send email via Next.js API
async function sendEmailViaNexjs(type: string, to: string, otp?: string, name?: string) {
    const NEXTJS_URL = process.env.NEXTJS_URL
    const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET

    if (!NEXTJS_URL || !INTERNAL_API_SECRET) {
        throw new Error("NEXTJS_URL or INTERNAL_API_SECRET not configured")
    }

    const response = await fetch(`${NEXTJS_URL}/api/internal/send-email`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_API_SECRET
        },
        body: JSON.stringify({ type, to, otp, name })
    })

    const data = await response.json()
    if (!data.success) {
        throw new Error(data.message || "Failed to send email")
    }
}

class AuthController {
    async signup(req: Request, res: Response) {
        try {
            // Zod validation
            const parsedData = signUpSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    message: parsedData.error.issues[0]?.message || "Invalid input"
                })
            }

            const { firstName, lastName, email, password } = parsedData.data

            // Check if user exists
            const existingUser = await authRepo.findUserByEmail(email)
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: "Email already exists"
                })
            }

            // Create user
            let user
            try {
                user = await authRepo.createUser({ firstName, lastName, email, password })
            } catch (error: any) {
                if (error.code === "P2002") {
                    return res.status(400).json({
                        success: false,
                        message: "Email already exists"
                    })
                }
                throw error
            }

            const userData = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
            }

            // Generate JWT token
            const token = generateToken(userData)

            logger.info(`[AUTH: signup] User created successfully: ${email}`)

            return res.status(201).json({
                success: true,
                message: "Account created successfully",
                data: { user: userData, token }
            })

        } catch (error) {
            logger.error(`[AUTH: signup] Error:`, error)
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            })
        }
    }

    async login(req: Request, res: Response) {
        try {
            // Zod validation
            const parsedData = signInSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    message: parsedData.error.issues[0]?.message || "Invalid input"
                })
            }

            const { email, password } = parsedData.data

            // Check if user exists
            const user = await authRepo.findUserByEmail(email)
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "No account found with this email"
                })
            }

            // Check if user has password set (might be social login user)
            if (!user.password) {
                return res.status(400).json({
                    success: false,
                    message: "Please use social login or reset your password"
                })
            }

            // Verify password
            const isValidPassword = await authRepo.verifyPassword(password, user.password)
            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    message: "Incorrect password"
                })
            }

            const userData = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
            }

            // Generate JWT token
            const token = generateToken(userData)

            logger.info(`[AUTH: login] User logged in: ${email}`)

            return res.status(200).json({
                success: true,
                message: "Logged in successfully",
                data: { user: userData, token }
            })

        } catch (error) {
            logger.error(`[AUTH: login] Error:`, error)
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            })
        }
    }

    async forgotPassword(req: Request, res: Response) {
        try {
            // Zod validation
            const parsedData = forgotPasswordSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    message: parsedData.error.issues[0]?.message || "Invalid input"
                })
            }

            const { email } = parsedData.data

            // Check if user exists
            const user = await authRepo.findUserByEmail(email)
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "No account found with this email"
                })
            }

            const otp = generateOTP()
            await authRepo.saveOTP(user.id, otp)

            // Send OTP via Next.js email API
            try {
                await sendEmailViaNexjs("otp", email, otp, user.firstName || "User")
            } catch (emailError) {
                logger.error(`[AUTH: forgotPassword] Email sending failed:`, emailError)
                return res.status(500).json({
                    success: false,
                    message: "Failed to send OTP email. Please try again later."
                })
            }

            logger.info(`[AUTH: forgotPassword] OTP sent to: ${email}`)

            return res.status(200).json({
                success: true,
                message: "OTP sent to your email"
            })

        } catch (error) {
            logger.error(`[AUTH: forgotPassword] Error:`, error)
            return res.status(500).json({
                success: false,
                message: "Failed to send OTP"
            })
        }
    }

    async verifyOTP(req: Request, res: Response) {
        try {
            // Zod validation
            const parsedData = verifyOtpSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    message: parsedData.error.issues[0]?.message || "Invalid input"
                })
            }

            const { email, otp } = parsedData.data

            // Check if user exists
            const user = await authRepo.findUserByEmail(email)
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "No account found with this email"
                })
            }

            const result = await authRepo.verifyOTP(email, otp)

            if (!result.valid) {
                return res.status(400).json({
                    success: false,
                    message: result.error
                })
            }

            logger.info(`[AUTH: verifyOTP] OTP verified for: ${email}`)

            return res.status(200).json({
                success: true,
                message: "OTP verified successfully",
                data: { resetToken: result.resetToken }
            })

        } catch (error) {
            logger.error(`[AUTH: verifyOTP] Error:`, error)
            return res.status(500).json({
                success: false,
                message: "Failed to verify OTP"
            })
        }
    }

    async changePassword(req: Request, res: Response) {
        try {
            // Zod validation
            const parsedData = changePasswordSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    message: parsedData.error.issues[0]?.message || "Invalid input"
                })
            }

            const { email, resetToken, newPassword } = parsedData.data

            // Check if user exists
            const user = await authRepo.findUserByEmail(email)
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "No account found with this email"
                })
            }

            const result = await authRepo.changePassword(email, resetToken, newPassword)

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: result.error
                })
            }

            logger.info(`[AUTH: changePassword] Password changed for: ${email}`)

            return res.status(200).json({
                success: true,
                message: "Password changed successfully"
            })

        } catch (error) {
            logger.error(`[AUTH: changePassword] Error:`, error)
            return res.status(500).json({
                success: false,
                message: "Failed to change password"
            })
        }
    }
}

export default new AuthController()
