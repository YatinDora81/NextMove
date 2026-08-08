import logger from "@/config/logger.js"
import { prismaClient } from "@repo/db/db"
import type { deviceRowSchemaType } from "@repo/types/ExtensionTypes"

/**
 * JF-001 SEC 7.4 / 8.2 — Prisma CRUD over `Device`, the row behind "Connected devices" in web
 * Settings and behind every paired extension install.
 *
 * Every method that reads or mutates a device takes `userId` and puts it in the `where` clause, so
 * a guessed device id from another tenant matches nothing. There is deliberately no `findById(id)`
 * overload without a user scope — the only way to reach a row here is to already own it.
 */

/** Columns the API is allowed to return for a device. A `select`, never the whole row. */
const DEVICE_SELECT = {
    id: true,
    name: true,
    lastSeen: true,
    createdAt: true
} as const

interface DeviceRecord {
    id: string
    name: string | null
    lastSeen: Date | null
    createdAt: Date
}

/** Shape a Prisma row into the wire contract from `@repo/types/ExtensionTypes` (dates → ISO). */
export const toDeviceRow = (row: DeviceRecord): deviceRowSchemaType => ({
    id: row.id,
    name: row.name,
    lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
    createdAt: row.createdAt.toISOString()
})

/**
 * The minimum a pairing exchange needs to sign the same 7-day JWT the auth controller signs
 * (SEC 8.2). Nothing sensitive: no password hash, no premium flag.
 */
export interface PairingUser {
    id: string
    email: string
    firstName: string
    lastName: string | null
}

class DeviceRepo {
    /**
     * Register a freshly paired install. `lastSeen` starts at the pairing moment so the Settings
     * list is meaningful before the device has synced anything.
     */
    async create(userId: string, name: string): Promise<deviceRowSchemaType> {
        try {
            const device = await prismaClient.device.create({
                data: {
                    userId,
                    name,
                    lastSeen: new Date()
                },
                select: DEVICE_SELECT
            })
            return toDeviceRow(device)
        } catch (error) {
            logger.error(`[REPO: create] Error creating device for user: ${userId}`, error)
            throw error
        }
    }

    /** All devices paired to a user, most recently seen first (nulls last). */
    async listForUser(userId: string): Promise<deviceRowSchemaType[]> {
        try {
            const devices = await prismaClient.device.findMany({
                where: { userId },
                select: DEVICE_SELECT,
                orderBy: [
                    { lastSeen: { sort: "desc", nulls: "last" } },
                    { createdAt: "desc" }
                ]
            })
            return devices.map(toDeviceRow)
        } catch (error) {
            logger.error(`[REPO: listForUser] Error listing devices for user: ${userId}`, error)
            throw error
        }
    }

    /** One device, scoped to its owner. Returns `null` when it does not exist *or* is not theirs. */
    async findById(userId: string, deviceId: string): Promise<deviceRowSchemaType | null> {
        try {
            const device = await prismaClient.device.findFirst({
                where: { id: deviceId, userId },
                select: DEVICE_SELECT
            })
            return device ? toDeviceRow(device) : null
        } catch (error) {
            logger.error(`[REPO: findById] Error fetching device ${deviceId} for user: ${userId}`, error)
            throw error
        }
    }

    /**
     * Revoke a device. `deleteMany` rather than `delete` so a foreign id is a no-op (`false`)
     * instead of a Prisma `P2025` that would leak whether the row exists at all.
     */
    async deleteForUser(userId: string, deviceId: string): Promise<boolean> {
        try {
            const result = await prismaClient.device.deleteMany({
                where: { id: deviceId, userId }
            })
            return result.count > 0
        } catch (error) {
            logger.error(`[REPO: deleteForUser] Error deleting device ${deviceId} for user: ${userId}`, error)
            throw error
        }
    }

    /**
     * Best-effort "this device is alive" stamp, called on authenticated sync traffic.
     *
     * Deliberately swallows its own errors: a failed bookkeeping write must never fail the sync
     * request that triggered it. Scoped by `userId` as well as `deviceId`, so a token carrying
     * someone else's `device_id` claim cannot stamp their row.
     */
    async touchLastSeen(userId: string, deviceId: string): Promise<void> {
        try {
            await prismaClient.device.updateMany({
                where: { id: deviceId, userId },
                data: { lastSeen: new Date() }
            })
        } catch (error) {
            logger.warn(`[REPO: touchLastSeen] Could not stamp device ${deviceId} for user: ${userId} — ${error}`)
        }
    }

    /**
     * Resolve the account a pairing code belongs to, for the token the exchange returns (SEC 8.2).
     * Returns `null` if the account vanished between minting the code and redeeming it.
     */
    async findPairingUser(userId: string): Promise<PairingUser | null> {
        try {
            const user = await prismaClient.users.findUnique({
                where: { id: userId },
                select: { id: true, email: true, firstName: true, lastName: true }
            })
            return user
        } catch (error) {
            logger.error(`[REPO: findPairingUser] Error fetching user for pairing: ${userId}`, error)
            throw error
        }
    }
}

export default new DeviceRepo()
