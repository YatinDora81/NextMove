import logger from "@/config/logger.js";
import chatRepo from "@/repository/chatRepo.js";
import { Request, Response } from "express";
import { createChatSchema } from "@repo/types/ZodTypes";

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

            const parsedData = createChatSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            // const

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