import { prismaClient } from "@repo/db/db"

class TemplateRepo {
    async getAllTemplates(userId: string) {
        try {
            const data = await prismaClient.templates.findMany({
                where: {
                    user: userId,
                    isDeleted: false
                },
                select: {
                    id: true,
                    name: true,
                    description: true,
                    type: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                    role: true,
                    user: true,
                    isDeleted: true,
                    roleRelation: {
                        select: {
                            id: true,
                            name: true,
                            desc: true,
                        }
                    },
                    rules: {
                        select: {
                            id: true,
                            rule: true,
                            templateId: true,
                        }
                    }
                }
            })
            return data
        } catch (error) {
            throw new Error(`Error at getting all templates ${error}`)
        }
    }
    
}

export default new TemplateRepo()