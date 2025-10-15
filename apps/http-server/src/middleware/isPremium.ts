import logger from "@/config/logger.js";
import userRepo from "@/repository/userRepo.js";
import { getRedis, setRedis } from "@/utils/redisCommon.js";
import { NextFunction, Request, Response } from "express";

export const isPremium = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                data: null,
                message: "Unauthorized"
            })
            return 
        }

        const cached = await getRedis(`premium:${req.user?.user_id}`)

        console.log("----------------------------------------Cached LOG----------------------------------------", cached);
        

        if (cached) {
            const obj = JSON.parse(cached)
            if (obj.isPaid) {
                next()
                return
            } else {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Not A Premium User"
                })
                return 
            }
        }
        const isPremium = await userRepo.getPremium(req.user!.user_id)
        await setRedis(`premium:${req.user?.user_id}`, JSON.stringify(isPremium), 86400)
        if (isPremium.isPaid) {
            next()
            return
        } else {
            res.status(401).json({
                success: false,
                data: null,
                message: "Not A Premium User"
            })
            return
        }

    } catch (error) {
        logger.error("Error in isPremium middleware", error)
        res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
        return
    }
}