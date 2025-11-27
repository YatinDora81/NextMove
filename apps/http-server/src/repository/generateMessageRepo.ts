import { prismaClient } from "@repo/db/db";
import { generateMessageSchemaType } from "@repo/types/ZodTypes";
import logger from "@/config/logger.js";

class GenerateMessageRepo {
    async generateMessage(userId: string, parsedData: generateMessageSchemaType) {
        try {
            const data = await prismaClient.$transaction(async tx => {
                let newCompanyData;
                if (parsedData.isNewCompany) {
                    newCompanyData = await tx.company.create({
                        data: {
                            name: parsedData.newCompanyName!,
                            createdBy: userId
                        }
                    })
                }

                const generatedMessage = await tx.generatedMessages.create({
                    data: {
                        user: userId,
                        company: parsedData.isNewCompany ? newCompanyData?.id! : parsedData.company!,
                        role: parsedData.role,
                        recruiterName: parsedData.recruiterName,
                        template: parsedData.template,
                        message: parsedData.message,
                        messageType: parsedData.messageType,
                        gender: parsedData.gender
                    }
                })
                return generatedMessage;
            })
            return data;
        }
        catch (error) {
            logger.error(`[REPO: generateMessage] Error generating message for user: ${userId}`, error)
            throw new Error(`Error at generating message ${error}`)
        }
    }
    async getGeneratedMessages(userId: string) {
        try {
            const data = await prismaClient.generatedMessages.findMany({
                where: { user: userId },
                orderBy: {
                    createdAt: 'desc'
                },
                include : {
                    roleRel: true,
                    templateRel: true,
                    company_gen_rel: {
                        include: {
                            createdByRelation: true,
                        }
                    },
                    userGen: true,
                }
            })
            return data
        }
        catch (error) {
            logger.error(`[REPO: getGeneratedMessages] Error fetching generated messages for user: ${userId}`, error)
            throw new Error(`Error at getting generated messages ${error}`)
        }
    }
}

export default new GenerateMessageRepo();