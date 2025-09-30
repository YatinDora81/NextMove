import { prismaClient } from '@repo/db/db'
import { createUserSchema } from '@repo/types/ZodTypes'
import { Request, Response } from 'express'
import { redisClient } from '../config/redis.js'
import { getRedis } from '../utils/redisCommon.js'
import logger from '../config/logger.js'

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
}

export default new UserControllers()