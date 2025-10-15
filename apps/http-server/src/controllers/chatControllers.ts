import logger from "@/config/logger.js";
import chatRepo from "@/repository/chatRepo.js";
import { Request, Response } from "express";
import { createChatSchema } from "@repo/types/ZodTypes";
import { gptResponseType } from "@repo/types/Types";
import gemini from "@/config/gemini.js";

class ChatControllers {
    async getAllChats(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const chats = await chatRepo.getAllChats(req.user.user_id)
            res.status(200).json({
                success: true,
                data: chats,
                message: "Chats fetched successfully"
            })

        } catch (error) {
            logger.error("Error in getAllChats controller", error)
            res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
    async createChat(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            // logger.info("------------------------------------------STFU--------------------------------------------------------------")

            const parsedData = createChatSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            logger.info(`----------------------------------------Parsed Data---------------------------------------- ${parsedData.data}`)

            const gptSTr: string = await gemini.generateMessage({
                isNewRoom: parsedData.data.isNewRoom,
                message: parsedData.data.message,
                previousMessages: parsedData.data.roomAllMessages,
                predefinedMessages: parsedData.data.predefinedMessages
            }) as string


            logger.info(`Gpt response ${gptSTr}`)
            
            
            const gptResponse: gptResponseType = JSON.parse(gptSTr)

            logger.info(`Gpt response parsed ${gptResponse} ress`)

            let roomDetails

            logger.info(`--------------------- Creating new room ----------------------------------------`)

            if (parsedData.data.isNewRoom) roomDetails = await chatRepo.createNewRoom(req.user.user_id, parsedData.data.predefinedMessages)

            logger.info(`--------------------- Room details ---------------------------------------- ${JSON.stringify(roomDetails)}`)

            const newChat = await chatRepo.createNewChat(req.user.user_id, gptResponse.new_message, parsedData.data.isNewRoom ? roomDetails!.id : parsedData.data.roomId!, parsedData.data)

            logger.info(`--------------------- New chat ---------------------------------------- ${JSON.stringify(newChat)}`)

            res.status(200).json({
                success: true,
                data: newChat,
                message: "Chat created successfully"
            })
        } catch (error) {
            logger.error("Error in createChat controller", error)
            res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
}

export default new ChatControllers()