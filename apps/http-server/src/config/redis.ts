import redis, { RedisClientType } from 'redis'
import { config } from 'dotenv'
import logger from './logger.js'

config()

const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 16000
const CONNECT_TIMEOUT = 10000
const PING_INTERVAL = 30000

const getBackoffDelay = (retries: number) => {
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, retries)
    return Math.min(delay, MAX_RECONNECT_DELAY)
}

const client: RedisClientType = redis.createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    disableOfflineQueue: true,
    pingInterval: PING_INTERVAL,
    socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        connectTimeout: CONNECT_TIMEOUT,
        reconnectStrategy(retries) {
            const delay = getBackoffDelay(retries)
            logger.warn(`Redis reconnect attempt #${retries + 1}, next try in ${delay}ms`)
            return delay
        },
    },
})

client.on('connect', () => {
    logger.info('Redis client connecting...')
})

client.on('ready', () => {
    logger.info('Redis ready')
})

client.on('error', (err: Error) => {
    logger.error(`Redis error: ${err?.message || err}`)
})

client.on('end', () => {
    logger.warn('Redis connection closed')
})

client.on('reconnecting', () => {
    logger.warn('Redis reconnecting...')
})

let isConnecting = false

export const connectRedis = async (attempt = 0): Promise<void> => {
    if (isConnecting || client.isOpen) return
    isConnecting = true
    try {
        await client.connect()
        logger.info('Redis connected')
    } catch (error) {
        const delay = getBackoffDelay(attempt)
        logger.error(`Redis connection failed, retrying in ${delay}ms: ${error}`)
        setTimeout(() => {
            void connectRedis(attempt + 1)
        }, delay).unref()
    } finally {
        isConnecting = false
    }
}

export const isRedisReady = () => client.isReady

void connectRedis()

export const redisClient = client
