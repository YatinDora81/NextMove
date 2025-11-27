import { Request, Response } from "express";
import { prismaClient } from '@repo/db/db'
import templateRepo from "../repository/templateRepo.js";
import { createTemplateBulkSchema, createTemplateSchema, deleteTemplateSchema, updateTemplateSchema } from "@repo/types/ZodTypes";
import logger from "@/config/logger.js";
import { getRedis, setRedis } from "@/utils/redisCommon.js";

class Templates {
    async getTemplates(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }

            const allTemplates = await templateRepo.getAllTemplates(req.user.user_id)
            return res.status(200).json({
                success: true,
                data: allTemplates,
                message: "Templates Fetched Successfully!!!"
            })

        } catch (error) {
            logger.error(`[CONTROLLER: getTemplates] Error fetching templates for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
    async createTemplate(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }
            const parsedData = createTemplateSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data!!!"
                })
            }
            const createdTemplate = await templateRepo.createTemplate(parsedData.data, req.user.user_id)
            return res.status(200).json({
                success: true,
                data: createdTemplate,
                message: "Template Created Successfully!!!"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: createTemplate] Error creating template for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
    async deleteTemplate(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }
            const parsedData = deleteTemplateSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data!!!"
                })
            }
            const deletedTemplate = await templateRepo.deleteTemplate(parsedData.data, req.user.user_id)
            return res.status(200).json({
                success: true,
                data: deletedTemplate,
                message: "Template Deleted Successfully!!!"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: deleteTemplate] Error deleting template for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
    async updateTemplate(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }
            const parsedData = updateTemplateSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data!!!"
                })
            }
            const updatedTemplate = await templateRepo.updateTemplate(parsedData.data, req.user.user_id)
            return res.status(200).json({
                success: true,
                data: updatedTemplate,
                message: "Template Updated Successfully!!!"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: updateTemplate] Error updating template for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
    async addTemplateBulk(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }
            const parsedData = createTemplateBulkSchema.safeParse(req.body)
            if (!parsedData.success) {
                return res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid Data!!!"
                })
            }
            const createdTemplateBulk = await templateRepo.createTemplateBulk(parsedData.data, req.user.user_id)
            return res.status(200).json({
                success: true,
                data: createdTemplateBulk,
                message: "Template Bulk Created Successfully!!!"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: addTemplateBulk] Error adding template bulk for user: ${req.user?.user_id}`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }

    async getCommonTemplates(req: Request, res: Response) {
        try {
            const cachedTemplates = await getRedis('common-templates')
            if (cachedTemplates) {
                res.status(200).json({
                    success: true,
                    data: JSON.parse(cachedTemplates),
                    message: "Common Templates Fetched Successfully!!!"
                })
                return
            }
            const commonTemplates = await templateRepo.getCommonTemplates()
            await setRedis('common-templates', JSON.stringify(commonTemplates), 604800)

            return res.status(200).json({
                success: true,
                data: commonTemplates,
                message: "Common Templates Fetched Successfully!!!"
            })
        }
        catch (error) {
            logger.error(`[CONTROLLER: getCommonTemplates] Error getting common templates`, error)
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
}

export default new Templates();
