import { Request, Response } from "express"
import logger from "@/config/logger.js"
import { isRedisReady } from "../config/redis.js"
import { flushRedis } from "@/utils/redisCommon.js"

class CacheController {
    async clearAllCache(req: Request, res: Response) {
        try {
            if (!isRedisReady()) {
                res.status(503).json({
                    success: false,
                    data: null,
                    message: "Cache is currently unavailable"
                })
                return
            }

            const cleared = await flushRedis()
            if (!cleared) {
                res.status(503).json({
                    success: false,
                    data: null,
                    message: "Cache is currently unavailable"
                })
                return
            }

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
