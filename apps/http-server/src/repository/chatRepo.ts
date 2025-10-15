import logger from "@/config/logger.js"
import { prismaClient } from "@repo/db/db"
import { createChatSchemaType } from "@repo/types/ZodTypes"

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
    async createNewRoom(userId: string, predefinedMessages: string[], name: string = "",
        description: string = "") {
        try {
            const room = await prismaClient.room.create({
                data: {
                    userId: userId,
                    predefinedMessages: predefinedMessages,
                    name: name,
                    description: description
                }
            })
            return room
        } catch (error) {
            logger.error("Error in createNewRoom repo", error)
            throw error
        }
    }
    async createNewChat(userId: string, message: string, roomId: string, parsedData: createChatSchemaType) {
        try {
            const chat = await prismaClient.message.createManyAndReturn({
                data: [{
                    userId: userId,
                    message: parsedData.message,
                    roomId: roomId,
                    by: "SELF"
                },
                {
                    userId: userId,
                    message: message,
                    roomId: roomId,
                    by: "AI"
                },
                ],
                include: {
                    room: true,
                }
            })
            return chat
        } catch (error) {
            logger.error("Error in createNewChat repo", error)
            throw error
        }
    }
}

export default new ChatRepo()