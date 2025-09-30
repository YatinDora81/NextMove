import { Request, Response } from "express";
import { prismaClient } from '@repo/db/db'
import templateRepo from "../repository/templateRepo.js";
import { createTemplateSchema, deleteTemplateSchema, updateTemplateSchema } from "@repo/types/ZodTypes";

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

        } catch (error) {
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
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
}

export default new Templates();

