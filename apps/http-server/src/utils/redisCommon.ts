import { redisClient } from "../config/redis.js"
import logger from '../config/logger.js'

export const getRedis = async (key: string) => {
    try {
        const cachedData = await redisClient.get(key)
        if (cachedData) {
            return cachedData;
        }
        return null
    } catch (error) {
        logger.error(`${Date.now()} Redis Get error: ${error}`)
        return null
    }
}

export const clearRedis = async (key: string) => {
    try {
        await redisClient.del(key)
    } catch (error) {
        logger.error(`${Date.now()} Redis Clear error: ${error}`)
    }
}

export const setRedis = async (key: string, value: string, expiration: number) => {
    try {
        await redisClient.set(key, value, { expiration: { type: 'EX', value: expiration } })
    } catch (error) {
        logger.error(`${Date.now()} Redis Set error: ${error}`)
    }
}

