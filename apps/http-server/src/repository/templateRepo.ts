import { prismaClient } from "@repo/db/db"
import { createTemplateSchemaType, deleteTemplateSchemaType, updateTemplateSchemaType } from "@repo/types/ZodTypes"
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
            const res = await prismaClient.$transaction(async (tx) => {
                const template = await tx.templates.create({
                    data: {
                        name: data.name,
                        description: data.description,
                        type: data.type,
                        content: data.content,
                        role: data.role,
                        user: userId,
                    }
                })

                const rules = await tx.templateRules.createMany({
                    data: data.rules.map((rule) => ({
                        rule: rule,
                        templateId: template.id,
                    }))
                })
                return { template, rules }
            })

            await clearRedis(`templates:${userId}`)
            return res

        }
        catch (error) {
            logger.error(`[REPO: createTemplate] Error creating template for user: ${userId}`, error)
            throw new Error(`Error at creating template ${error}`)
        }
    }
    async deleteTemplate(data: deleteTemplateSchemaType, userId: string) {
        try {
            const res = await prismaClient.templates.update({
                where: {
                    user: userId,
                    id: data.templateId
                },
                data: {
                    isDeleted: true
                }
            })
            await clearRedis(`templates:${userId}`)
            return res
        } catch (error) {
            logger.error(`[REPO: deleteTemplate] Error deleting template for user: ${userId}`, error)
            throw new Error(`Error at deleting template ${error}`)
        }
    }
    async updateTemplate(data: updateTemplateSchemaType, userId: string) {
        try {
            const res = await prismaClient.$transaction(async (tx) => {
                const template = await tx.templates.update({
                    where: {
                        user: userId,
                        id: data.templateId
                    },
                    data:{
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
                const rules = await tx.templateRules.createMany({
                    data: data.rules.map((rule) => ({
                        rule: rule,
                        templateId: data.templateId
                    }))
                })
                return { template, rules }
            })
            await clearRedis(`templates:${userId}`)
            return res
        }
        catch (error) {
            logger.error(`[REPO: updateTemplate] Error updating template for user: ${userId}`, error)
            throw new Error(`Error at updating template ${error}`)
        }
    }
}

export default new TemplateRepo()