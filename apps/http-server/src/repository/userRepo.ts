import logger from "@/config/logger.js"
import { clearRedis } from "@/utils/redisCommon.js"
import { prismaClient } from "@repo/db/db"
import { updateUserDetailsSchemaType } from "@repo/types/ZodTypes"

class UserRepo {
    async updateUserDetails(data: updateUserDetailsSchemaType) {
        try {
            const { full_name, image_url, userId } = data
            const res = await prismaClient.users.update({
                where: {
                    id: userId
                },
                data: {
                    name: full_name,
                    profilePic: image_url
                }
            })

            clearRedis(`user-${userId}`);
            logger.info(`User details updated successfully in DB , ${res}`)
            return res;
        } catch (error) {
            throw new Error(`Failed to update user details in DB , ${error}`)
        }
    }
}

export default new UserRepo()