import roleRepo from "@/repository/roleRepo.js";
import { clearRedis, getRedis, setRedis } from "@/utils/redisCommon.js";
import { createRoleSchema, deleteRoleSchema } from "@repo/types/ZodTypes";
import { Request, Response } from "express";
import logger from "@/config/logger.js";

class RoleControllers {
    async getRoles(req: Request, res: Response) {
        try {
            const cachedRoles = await getRedis('roles');
            if (cachedRoles) {
                return res.status(200).json({
                    success: true,
                    data: JSON.parse(cachedRoles),
                    message: "Roles Retrieved Successfully"
                })
            }

            const roles = await roleRepo.getAllRoles();
            await setRedis('roles', JSON.stringify(roles), 86400);

        } catch (error) {
            logger.error(`[CONTROLLER: getRoles] Error fetching roles`, error)
            return res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
    async createRole(req: Request, res: Response) {
        try {
            const parsedData = createRoleSchema.safeParse(req.body);

            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data"
                })
            }

            const data = await roleRepo.createRole(parsedData.data);
            await clearRedis('roles');

            return res.status(200).json({
                success: true,
                data: data,
                message: "Role Created Successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: createRole] Error creating role`, error)
            return res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
    async deleteRole(req: Request, res: Response) {
        try {
            const parsedData = deleteRoleSchema.safeParse(req.body);
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data"
                })
            }

            const data = await roleRepo.deleteRole(parsedData.data);
            await clearRedis('roles');

            res.status(200).json({
                success: true,
                data: data,
                message: "Role Deleted Successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: deleteRole] Error deleting role`, error)
            return res.status(500).json({
                success: false,
                data: error,
                message: "Internal Server Error"
            })
        }
    }
}

export default new RoleControllers();