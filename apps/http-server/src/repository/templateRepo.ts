import { prismaClient } from "@repo/db/db"
import { createTemplateBulkSchemaType, createTemplateSchemaType, deleteTemplateSchemaType, makeTemplateUsingGeminiSchemaType, updateTemplateSchemaType } from "@repo/types/ZodTypes"
import logger from "@/config/logger.js"
import { clearRedis, getRedis, setRedis } from "../utils/redisCommon.js"
import gemini from "@/config/gemini.js"
import { Template_GPT_Instuction } from "@/utils/template-instruction.js"

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

            const res = await prismaClient.$transaction(async (tx: any) => {
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
                return { template: { ...template, "rules": rules }, rules }
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
            const res = await prismaClient.$transaction(async (tx: any) => {
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
                return { template: { ...template, "rules": rules }, rules }
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
            await clearRedis('common-templates')
            const res = await prismaClient.$transaction(async (tx: any) => {
                const templates = await tx.templates.createManyAndReturn({
                    data: data.map((template) => ({
                        name: template.name,
                        description: template.description,
                        type: template.type,
                        content: template.content,
                        role: template.role,
                        user: userId,
                        isCommon: true,
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
                    templates.map(async (template: any, index: number) => {
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
                return templates.map((t: any, i: number) => { return { ...t, rules: allRules[i]?.rules } });
            })

            return res

        }
        catch (error) {
            logger.error(`[REPO: createTemplateBulk] Error creating template bulk for user: ${userId}`, error)
            throw new Error(`Error at creating template bulk ${error}`)
        }
    }

    async getCommonTemplates() {
        try {
            const data = await prismaClient.templates.findMany({
                where: {
                    isCommon: true,
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
            return data
        } catch (error) {
            logger.error(`[REPO: getCommonTemplates] Error getting common templates`, error)
            throw new Error(`Error at getting common templates ${error}`)
        }
    }
    async aiGenerateTemplate(data: makeTemplateUsingGeminiSchemaType, userId: string) {
        try {
            const generatedTemplate = await gemini.generateMessage(data, Template_GPT_Instuction)
            const jsonData = await JSON.parse(generatedTemplate as unknown as string)
            const db_data = await prismaClient.$transaction(async (tx: any) => {
                const template = await tx.templates.create({
                    data: {
                        name: jsonData.templateName,
                        description: jsonData.templateDescription,
                        type: data.type,
                        content: jsonData.message,
                        role: data.roleNameId,
                        user: userId,
                        createdBy: "AI"
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
                const rules = await tx.templateRules.createMany({
                    data: jsonData.rules.map((rule: string) => ({
                        rule: rule,
                        templateId: template.id
                    }))
                })
                return { template: { ...template, "rules": rules }, }
            })
            return { data: db_data, ai_data: jsonData }
        } catch (error) {
            logger.error(`[REPO: aiGenerateTemplate] Error generating template for user: ${userId}`, error)
            throw new Error(`Error at generating template ${error}`)
        }
    }
}

export default new TemplateRepo()