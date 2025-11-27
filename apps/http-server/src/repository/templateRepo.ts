import { prismaClient } from "@repo/db/db"
import { createTemplateBulkSchemaType, createTemplateSchemaType, deleteTemplateSchemaType, updateTemplateSchemaType } from "@repo/types/ZodTypes"
import logger from "@/config/logger.js"
import { clearRedis, getRedis, setRedis } from "../utils/redisCommon.js"

class TemplateRepo {
    async getAllTemplates(userId: string) {
        try {

            const cachedTemplates = await getRedis(`templates:${userId}`)
            if (cachedTemplates) {
                return JSON.parse(cachedTemplates)
            }

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
                },
                orderBy: {
                    createdAt: 'desc'
                }
            })

            await setRedis(`templates:${userId}`, JSON.stringify(data), 86400)

            return data
        } catch (error) {
            logger.error(`[REPO: getAllTemplates] Error fetching templates for user: ${userId}`, error)
            throw new Error(`Error at getting all templates ${error}`)
        }
    }
    async createTemplate(data: createTemplateSchemaType, userId: string) {
        try {
            await clearRedis(`templates:${userId}`)

            const res = await prismaClient.$transaction(async (tx) => {
                const template = await tx.templates.create({
                    data: {
                        name: data.name,
                        description: data.description,
                        type: data.type,
                        content: data.content,
                        role: data.role,
                        user: userId,
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
                    },
                })

                const rules = await tx.templateRules.createManyAndReturn({
                    data: data.rules.map((rule) => ({
                        rule: rule,
                        templateId: template.id,
                    }))
                })
                return { template : {...template , "rules" : rules}, rules }
            })

            
            return res

        }
        catch (error) {
            logger.error(`[REPO: createTemplate] Error creating template for user: ${userId}`, error)
            throw new Error(`Error at creating template ${error}`)
        }
    }
    async deleteTemplate(data: deleteTemplateSchemaType, userId: string) {
        try {
            await clearRedis(`templates:${userId}`)

            const res = await prismaClient.templates.update({
                where: {
                    user: userId,
                    id: data.templateId
                },
                data: {
                    isDeleted: true
                }
            })
            
            return res
        } catch (error) {
            logger.error(`[REPO: deleteTemplate] Error deleting template for user: ${userId}`, error)
            throw new Error(`Error at deleting template ${error}`)
        }
    }
    async updateTemplate(data: updateTemplateSchemaType, userId: string) {
        try {
            await clearRedis(`templates:${userId}`)
            const res = await prismaClient.$transaction(async (tx) => {
                const template = await tx.templates.update({
                    where: {
                        user: userId,
                        id: data.templateId
                    },
                    data: {
                        name: data.name,
                        description: data.description,
                        type: data.type,
                        content: data.content,
                        role: data.role,
                    }
                })
                if (data.isRulesChanged) {
                    await tx.templateRules.deleteMany({
                        where: {
                            templateId: data.templateId
                        }
                    })
                }
                const rules = await tx.templateRules.createManyAndReturn({
                    data: data.rules.map((rule) => ({
                        rule: rule,
                        templateId: data.templateId
                    }))
                })
                return { template : {...template , "rules" : rules}, rules }
            })
            
            return res
        }
        catch (error) {
            logger.error(`[REPO: updateTemplate] Error updating template for user: ${userId}`, error)
            throw new Error(`Error at updating template ${error}`)
        }
    }
    async createTemplateBulk(data: createTemplateBulkSchemaType, userId: string) {
        try {
            const res = await prismaClient.$transaction(async (tx) => {
                const templates = await tx.templates.createManyAndReturn({
                    data: data.map((template) => ({
                        name: template.name,
                        description: template.description,
                        type: template.type,
                        content: template.content,
                        role: template.role,
                        user: userId,
                    })),
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
                    },
                })

                const allRules = await Promise.all(
                    templates.map(async (template, index) => {
                        const templateData = data[index];
                        if (!templateData) {
                            throw new Error(`Template data not found for index ${index}`);
                        }
                        const rules = await tx.templateRules.createManyAndReturn({
                            data: templateData.rules.map((rule) => ({
                                rule: rule,
                                templateId: template.id,
                            }))
                        });
                        return { template: { ...template, rules }, rules };
                    })
                );
                return templates.map((t,i)=>{return {...t, rules: allRules[i]?.rules}});
            })

            return res

        }
        catch (error) {
            logger.error(`[REPO: createTemplateBulk] Error creating template bulk for user: ${userId}`, error)
            throw new Error(`Error at creating template bulk ${error}`)
        }
    }
}

export default new TemplateRepo()