import { prismaClient } from "@repo/db/db"
import { createRoleSchemaType, deleteRoleSchemaType } from "@repo/types/ZodTypes"

class RoleRepo {
    async getAllRoles() {
        try {
            const data = await prismaClient.role.findMany({
                select: {
                    id: true,
                    name: true,
                    desc: true,
                    createdAt: true
                }
            })
            return data
        } catch (error) {
            throw new Error(`Error at getting all roles ${error}`)
        }
    }
    async createRole(roles : createRoleSchemaType){
        try {
            const data = await prismaClient.role.createManyAndReturn({
                data : roles.map((r) => ({
                    name : r,
                }))
            })
            return data
        } catch (error) {
            throw new Error(`Error at creating role ${error}`)
        }
    }
    async deleteRole(roles : deleteRoleSchemaType){
        try {
            const data = await prismaClient.role.deleteMany({
                where : {
                    name : {
                        in : roles
                    }
                }
            })
            return data
        } catch (error) {
            throw new Error(`Error at deleting role ${error}`)
        }
    }
}

export default new RoleRepo();