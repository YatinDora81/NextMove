import { prismaClient } from "@repo/db/db"

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
    // async createRole(role: string){
    //     try {

    //     } catch (error) {
    //         throw new Error(`Error at creating role ${error}`)
    //     }
    // }
    // async deleteRole(roleId: string){
    //     try {

    //     } catch (error) {
    //         throw new Error(`Error at deleting role ${error}`)
    //     }
    // }
}

export default new RoleRepo();