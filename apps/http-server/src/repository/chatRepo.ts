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
                },
                orderBy:{
                    updatedAt: "desc"
                }
            })
            return chats
        } catch (error) {
            logger.error(`[REPO: getAllChats] Error fetching chats from database for user: ${userId}`, error)
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
            logger.error(`[REPO: createNewRoom] Error creating new room for user: ${userId}`, error)
            throw error
        }
    }
    async createNewChat(userId: string, message: string, roomId: string, parsedData: createChatSchemaType) {
        try {
            const chat = await prismaClient.$transaction(async tx =>{
                const newChatMessages = await tx.message.createManyAndReturn({
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

                await tx.room.update({
                    where: {
                        id: roomId
                    },
                    data: {
                        updatedAt: new Date()
                    }
                })

                return newChatMessages;
            })
            return chat
        } catch (error) {
            logger.error(`[REPO: createNewChat] Error creating new chat for user: ${userId}`, error)
            throw error
        }
    }
}

export default new ChatRepo()