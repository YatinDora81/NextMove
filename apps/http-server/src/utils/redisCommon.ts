import { isRedisReady, redisClient } from "../config/redis.js"
import logger from '../config/logger.js'

const REDIS_OPERATION_TIMEOUT = 1500

const withTimeout = async <T>(operation: Promise<T>, label: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`Redis ${label} timed out after ${REDIS_OPERATION_TIMEOUT}ms`)),
                    REDIS_OPERATION_TIMEOUT
                )
            })
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

export const getRedis = async (key: string) => {
    if (!isRedisReady()) return null
    try {
        const cachedData = await withTimeout(redisClient.get(key), `GET ${key}`)
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
    if (!isRedisReady()) return false
    try {
        await withTimeout(redisClient.del(key), `DEL ${key}`)
        return true
    } catch (error) {
        logger.error(`${Date.now()} Redis Clear error: ${error}`)
        return false
    }
}

export const setRedis = async (key: string, value: string, expiration: number) => {
    if (!isRedisReady()) return false
    try {
        await withTimeout(
            redisClient.set(key, value, { expiration: { type: 'EX', value: expiration } }),
            `SET ${key}`
        )
        return true
    } catch (error) {
        logger.error(`${Date.now()} Redis Set error: ${error}`)
        return false
    }
}

export const flushRedis = async () => {
    if (!isRedisReady()) return false
    try {
        await withTimeout(redisClient.flushAll(), 'FLUSHALL')
        return true
    } catch (error) {
        logger.error(`${Date.now()} Redis Flush error: ${error}`)
        return false
    }
}
