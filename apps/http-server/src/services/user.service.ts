import logger from "@/config/logger.js";
import { redisClient } from "@/config/redis.js";
import { getRedis } from "@/utils/redisCommon.js";
import Prisma, { prismaClient } from "@repo/db/db";
import { createUserSchemaType, deleteUserSchemaType, updateUserDetailsSchemaType } from "@repo/types/ZodTypes";

class UserService {
    async createUser(data: createUserSchemaType) {
        try {

            const cachedUser = await getRedis(`user:${data.id}`)
            if (cachedUser) {
                return {
                    user: JSON.parse(cachedUser),
                    message: "User Already Exists"
                }
            }

            const { id, firstName, lastName, email, profilePic } = data
            let user;

            try {
                user = await prismaClient.users.create({
                    data: {
                        id, firstName, lastName, email, profilePic
                    }
                })
            }
            catch (error: any) {
                if (error.code === 'P2002') {
                    return {
                        user: user,
                        message: "User Already Exists"
                    }
                } else throw error
            }

            try {
                await redisClient.set(`user:${id}`, JSON.stringify(user), { expiration: { type: 'EX', value: 86400 } })
            } catch (redisError) {
                logger.error(`${Date.now()} redisError`, redisError)
            }
            return { user, message: "User Created Successfully" }
        } catch (error) {
            logger.error(`[SERVICE: createUser] Error creating user`, error)
            throw new Error("Something Went Wrong In User Service " + error);
        }
    }
    async updateUserByClerk(data: updateUserDetailsSchemaType) {
        try {
            const { firstName, lastName, image_url, userId } = data
            const user = await prismaClient.users.update({
                where: { id: userId },
                data: { firstName, lastName: lastName !== null ? lastName : '', profilePic: image_url }
            })
            return { user, message: "User Updated Successfully" }
        } catch (error) {
            logger.error(`[SERVICE: updateUserByClerk] Error updating user`, error)
            throw new Error("Something Went Wrong In User Service " + error);
        }
    }
    async deleteUserByClerk(data: deleteUserSchemaType) {
        try {
            const { userId } = data
            const user = await prismaClient.users.delete({
                where: { id: userId }
            })
            return { user, message: "User Deleted Successfully" }
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                return { user: null, message: "User not found, skipping deletion" }
            }
            logger.error(`[SERVICE: deleteUserByClerk] Error deleting user`, error)
            throw new Error("Something Went Wrong In User Service " + error);
        }
    }
}

export default new UserService();