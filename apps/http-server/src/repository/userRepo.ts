import logger from "@/config/logger.js"
import { clearRedis } from "@/utils/redisCommon.js"
import { prismaClient } from "@repo/db/db"
import { updatePremiumSchemaType, updateUserDetailsSchemaType } from "@repo/types/ZodTypes"

class UserRepo {
    async updateUserDetails(data: updateUserDetailsSchemaType) {
        try {
            const { firstName, lastName, image_url, userId } = data
            await clearRedis(`user-${userId}`);
            const res = await prismaClient.users.update({
                where: {
                    id: userId
                },
                data: {
                    firstName,
                    lastName: lastName!==null ? lastName : '',
                    profilePic: image_url
                }
            })

            
            logger.info(`User details updated successfully in DB , ${res}`)
            return res;
        } catch (error) {
            logger.error(`[REPO: updateUserDetails] Error updating user details for user: ${data.userId}`, error)
            throw new Error(`Failed to update user details in DB , ${error}`)
        }
    }
    async getPremium(userId: string) {
        try {
            const res = await prismaClient.users.findUnique({
                where: { id: userId }
            })
            return { isPaid: res?.isPaid || false }
        } catch (error) {
            logger.error(`[REPO: getPremium] Error fetching premium status for user: ${userId}`, error)
            throw new Error(`Failed to get premium in DB , ${error}`)
        }
    }
    async updatePremium(data: updatePremiumSchemaType) {
        try {
            const res = await prismaClient.users.updateManyAndReturn({
                where: { email: { in: data } },
                data: { isPaid: true }
            })
            return res
        }
        catch(error){
            logger.error(`[REPO: updatePremium] Error updating premium status`, error)
            throw new Error(`Failed to update premium in DB , ${error}`)
        }
    }
    async getUsers() {
        try {
            const res = await prismaClient.users.findMany()
            return res
        }
        catch (error) {
            logger.error(`[REPO: getUsers] Error fetching all users`, error)
            throw new Error(`Failed to get users in DB , ${error}`)
        }
    }
    
}

export default new UserRepo()