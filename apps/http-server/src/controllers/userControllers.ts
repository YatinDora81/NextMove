import { prismaClient } from '@repo/db/db'
import { createUserSchema, updatePremiumSchema, updateUserDetailsSchema } from '@repo/types/ZodTypes'
import { Request, Response } from 'express'
import { redisClient } from '../config/redis.js'
import { clearRedis, getRedis, setRedis } from '../utils/redisCommon.js'
import logger from '../config/logger.js'
import { updateUserDeatilsClerk } from '@/utils/updateUserDetails.js'
import userRepo from '@/repository/userRepo.js'

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

            const cachedUser = await getRedis(`user:${parsedData.data.id}`)
            if (cachedUser) {
                res.status(200).json({
                    success: true,
                    data: JSON.parse(cachedUser),
                    message: "User Already Exists"
                })
                return
            }

            const { id, name, email, profilePic } = parsedData.data
            let user;

            try {
                user = await prismaClient.users.create({
                    data: {
                        id, name, email, profilePic
                    }
                })
            }
            catch (error: any) {
                if (error.code === 'P2002') {
                    res.status(200).json({
                        success: true,
                        data: user,
                        message: "User Already Exists"
                    })
                    return
                } else throw error
            }

            try {
                await redisClient.set(`user:${id}`, JSON.stringify(user), { expiration: { type: 'EX', value: 86400 } })
            } catch (redisError) {
                logger.error(`${Date.now()} redisError`)
            }

            res.status(200).json({
                success: true,
                data: user,
                message: "User Created Successfully"
            })
        } catch (error) {
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
            const { full_name, image_url, userId } = parsedData.data
            const clerkResponse = await updateUserDeatilsClerk(userId, { full_name, image_url })
            const dbresponse = await userRepo.updateUserDetails(parsedData.data)

            res.status(200).json({
                success: true,
                data: {
                    clerkResponse,
                    dbresponse
                },
                message: "User Details Updated Successfully"
            })

        } catch (error) {
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
            const getCache = await getRedis(`premium:${req.user.email}`)
            if (getCache) {
                res.status(200).json({
                    success: true,
                    data: JSON.parse(getCache),
                    message: "User is Premium"
                })
                return
            }
            const isPremium = await userRepo.getPremium(req.user.user_id)
            await setRedis(`premium:${req.user.email}`, JSON.stringify(isPremium), 86400)
            res.status(200).json({
                success: true,
                data: isPremium,
                message: "User is Premium"
            })
        } catch (error) {
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
            parsedData.data.forEach(async (email) => {
                await clearRedis(`premium:${email}`)
            })
            res.status(200).json({
                success: true,
                data: user,
                message: "Premium Updated Successfully"
            })
        } catch (error) {
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
            res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
}

export default new UserControllers()