import { Request, Response } from "express"
import logger from "@/config/logger.js"
import { redisClient } from "../config/redis.js"

class CacheController {
    async clearAllCache(req: Request, res: Response) {
        try {
            await redisClient.flushAll();
            res.status(200).json({
                success: true,
                data: "All cache cleared successfully",
                message: "All cache cleared successfully"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: clearAllCache] Error clearing all cache`, error)
            res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
}

export default new CacheController()