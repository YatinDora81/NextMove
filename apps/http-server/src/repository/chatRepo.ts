import logger from "@/config/logger.js"
import { prismaClient } from "@repo/db/db"

class ChatRepo {
    async getAllChats(userId: string) {
        try {
            const chats = await prismaClient.room.findMany({
                where: {
                    userId: userId
                },
                select: {
                    id: true,
                    name: true,
                    description: true,
                    predefinedMessages: true,
                    userId: true,
                    createdAt: true,
                    updatedAt: true,
                    messages: {
                        select: {
                            id: true,
                            message: true,
                            by: true,
                            userId: true,
                            roomId: true,
                            createdAt: true,
                            updatedAt: true,
                        }
                    }
                }
            })
return chats
        } catch (error) {
    logger.error("Error in getAllChats repo", error)
    throw error
}
    }
}

export default new ChatRepo()