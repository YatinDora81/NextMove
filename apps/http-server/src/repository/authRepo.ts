import logger from "@/config/logger.js"
import { prismaClient } from "@repo/db/db"
import bcrypt from "bcryptjs"

class AuthRepo {
    async findUserByEmail(email: string) {
        try {
            const user = await prismaClient.users.findUnique({
                where: { email }
            })
            return user
        } catch (error) {
            logger.error(`[REPO: findUserByEmail] Error finding user by email: ${email}`, error)
            throw new Error(`Failed to find user by email`)
        }
    }

    async createUser(data: { firstName: string; lastName?: string; email: string; password: string }) {
        try {
            const hashedPassword = await bcrypt.hash(data.password, 12)
            const user = await prismaClient.users.create({
                data: {
                    firstName: data.firstName,
                    lastName: data.lastName || "",
                    email: data.email,
                    password: hashedPassword,
                    isPaid: true, // Premium by default
                }
            })
            return user
        } catch (error) {
            logger.error(`[REPO: createUser] Error creating user: ${data.email}`, error)
            throw new Error(`Failed to create user`)
        }
    }

    async verifyPassword(plainPassword: string, hashedPassword: string) {
        return await bcrypt.compare(plainPassword, hashedPassword)
    }

    async saveOTP(userId: string, otp: string) {
        try {
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
            
            // Delete any existing unused OTPs for this user
            await prismaClient.passwordReset.deleteMany({
                where: { userId, used: false }
            })
            
            // Create new OTP record
            await prismaClient.passwordReset.create({
                data: {
                    userId,
                    otp,
                    expiresAt
                }
            })
        } catch (error) {
            logger.error(`[REPO: saveOTP] Error saving OTP for user: ${userId}`, error)
            throw new Error(`Failed to save OTP`)
        }
    }

    async verifyOTP(email: string, otp: string) {
        try {
            const user = await prismaClient.users.findUnique({
                where: { email }
            })

            if (!user) {
                return { valid: false, error: "Invalid OTP" }
            }

            // Find valid OTP record
            const otpRecord = await prismaClient.passwordReset.findFirst({
                where: {
                    userId: user.id,
                    otp,
                    used: false,
                    expiresAt: { gt: new Date() }
                }
            })

            if (!otpRecord) {
                return { valid: false, error: "Invalid or expired OTP" }
            }

            // Generate reset token and update the record
            const resetToken = `reset_${user.id}_${Date.now()}`
            await prismaClient.passwordReset.update({
                where: { id: otpRecord.id },
                data: {
                    resetToken,
                    expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes for reset
                }
            })

            return { valid: true, resetToken, userId: user.id }
        } catch (error) {
            logger.error(`[REPO: verifyOTP] Error verifying OTP for email: ${email}`, error)
            throw new Error(`Failed to verify OTP`)
        }
    }

    async changePassword(email: string, resetToken: string, newPassword: string) {
        try {
            const user = await prismaClient.users.findUnique({
                where: { email }
            })

            if (!user) {
                return { success: false, error: "Invalid reset token" }
            }

            // Find valid reset token
            const resetRecord = await prismaClient.passwordReset.findFirst({
                where: {
                    userId: user.id,
                    resetToken,
                    used: false,
                    expiresAt: { gt: new Date() }
                }
            })

            if (!resetRecord) {
                return { success: false, error: "Invalid or expired reset token" }
            }

            const hashedPassword = await bcrypt.hash(newPassword, 12)
            
            // Update password and mark reset as used
            await prismaClient.$transaction([
                prismaClient.users.update({
                    where: { id: user.id },
                    data: { password: hashedPassword }
                }),
                prismaClient.passwordReset.update({
                    where: { id: resetRecord.id },
                    data: { used: true }
                })
            ])

            return { success: true }
        } catch (error) {
            logger.error(`[REPO: changePassword] Error changing password for email: ${email}`, error)
            throw new Error(`Failed to change password`)
        }
    }
}

export default new AuthRepo()
