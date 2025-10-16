import { prismaClient } from '@repo/db/db'
import { createUserSchema, updatePremiumSchema, updateUserDetailsSchema } from '@repo/types/ZodTypes'
import { Request, Response } from 'express'
import { redisClient } from '../config/redis.js'
import { clearRedis, getRedis, setRedis } from '../utils/redisCommon.js'
import logger from '../config/logger.js'
import { updateUserDeatilsClerk } from '@/utils/updateUserDetails.js'
import userRepo from '@/repository/userRepo.js'
import userService from '@/services/user.service.js'

class UserControllers {
    async createUser(req: Request, res: Response) {
        try {
            const parsedData = createUserSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data"
                })
                return
            }

            const { user, message } = await userService.createUser(parsedData.data) as { user: any, message: string }

            res.status(200).json({
                success: true,
                data: user,
                message: message
            })
        } catch (error) {
            logger.error(`[CONTROLLER: createUser] Error creating user`, error)
            res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
    async updateUserDetails(req: Request, res: Response) {
        try {
            const parsedData = updateUserDetailsSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data"
                })
                return
            }
            const { firstName, lastName, image_url, userId } = parsedData.data
            logger.info("Body parsed successfully")
            const clerkResponse = await updateUserDeatilsClerk(userId, { firstName, lastName: lastName!== null ? lastName : '', image_url })
        logger.info("Clerk response successfully")
        const dbresponse = await userRepo.updateUserDetails(parsedData.data)
        logger.info("DB response successfully")
        res.status(200).json({
            success: true,
            data: {
                clerkResponse,
                dbresponse
            },
            message: "User Details Updated Successfully"
        })

    } catch(error) {
        logger.error(`[CONTROLLER: updateUserDetails] Error updating user details`, error)
        res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
    }
}
    async isPremium(req: Request, res: Response) {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                data: null,
                message: "Unauthorized"
            })
            return
        }
        const getCache = await getRedis(`premium:${req.user.user_id}`)
        if (getCache) {
            res.status(200).json({
                success: true,
                data: JSON.parse(getCache),
                message: "User is Premium"
            })
            return
        }
        const isPremium = await userRepo.getPremium(req.user.user_id)
        await setRedis(`premium:${req.user.user_id}`, JSON.stringify(isPremium), 86400)
        res.status(200).json({
            success: true,
            data: isPremium,
            message: "User is Premium"
        })
    } catch (error) {
        logger.error(`[CONTROLLER: isPremium] Error checking premium status for user: ${req.user?.user_id}`, error)
        res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
    }
}
    async updatePremium(req: Request, res: Response) {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                data: null,
                message: "Unauthorized"
            })
            return
        }
        const parsedData = updatePremiumSchema.safeParse(req.body)
        if (!parsedData.success) {
            res.status(400).json({
                success: false,
                data: parsedData.error,
                message: "Invalid Data"
            })
            return
        }

        const user = await userRepo.updatePremium(parsedData.data)
        user.forEach(async (user) => {
            await clearRedis(`premium:${user.id}`)
        })
        res.status(200).json({
            success: true,
            data: user,
            message: "Premium Updated Successfully"
        })
    } catch (error) {
        logger.error(`[CONTROLLER: updatePremium] Error updating premium status`, error)
        res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
    }
}
    async getUsers(req: Request, res: Response) {
    try {
        const users = await userRepo.getUsers()
        res.status(200).json({
            success: true,
            data: users,
            message: "Users Fetched Successfully"
        })
    }
    catch (error) {
        logger.error(`[CONTROLLER: getUsers] Error fetching users`, error)
        res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
    }
}
}

export default new UserControllers()