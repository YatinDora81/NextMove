import generateMessageRepo from "@/repository/generateMessageRepo.js";
import { clearRedis, getRedis } from "@/utils/redisCommon.js";
import { generateMessageSchema } from "@repo/types/ZodTypes";
import { Request, Response } from "express";
import logger from "@/config/logger.js";

class GeneratedMessageControllers {
    async generateMessage(req: Request, res: Response) {
        try {
            const parsedData = generateMessageSchema.safeParse(req.body);
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    data: "Unauthorized",
                    message: "Unauthorized"
                })
            }
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data"
                })
            }
            const data = await generateMessageRepo.generateMessage(req.user.user_id, parsedData.data);
            await clearRedis(`generated-${req.user.user_id}`);

            return res.status(200).json({
                success: true,
                data: data,
                message: "Message Generated Successfully"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: generateMessage] Error generating message for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
    async getGeneratedMessages(req: Request, res: Response) {
        try {
            if(!req.user){
                return res.status(401).json({
                    success: false,
                    data: "Unauthorized",
                    message: "Unauthorized"
                })
            }
            const cached = await getRedis(`generated-${req.user.user_id}`);
            if(cached){
                return res.status(200).json({
                    success: true,
                    data: cached,
                    message: "Generated Messages Fetched Successfully"
                })
            }
            const data = await generateMessageRepo.getGeneratedMessages(req.user.user_id);
            return res.status(200).json({
                success: true,
                data: data,
                message: "Generated Messages Fetched Successfully"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: getGeneratedMessages] Error fetching generated messages for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
}

export default new GeneratedMessageControllers();