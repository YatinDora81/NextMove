import redis, { RedisClientType } from 'redis'
import {config} from 'dotenv'

config()

const client: RedisClientType = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT!),
        reconnectStrategy(retries) {
            const delay = Math.min(retries * 100, 5000);
            console.log(`Redis reconnect attempt #${retries}, next in ${delay}ms`);
            return delay;
        },
    }
})

client.on('connect', () => {
    console.log('Redis client connecting...');
});

client.on('ready', () => {
    console.log('Redis ready');
});

client.on('error', (err) => {
    console.error('Redis error:', err);
});

client.on('end', () => {
    console.warn('Redis connection closed');
});

client.on('reconnecting', (delay) => {
    console.log(`Redis reconnecting in ${delay}ms`);
});


client.connect().then(() => {
    console.log('Redis connected');
}).catch((err: Error) => {
    console.error('Redis connection error:', err);
});

export const redisClient = client;