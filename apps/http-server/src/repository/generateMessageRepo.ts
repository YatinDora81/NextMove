import { prismaClient } from "@repo/db/db";
import { generateMessageSchemaType } from "@repo/types/ZodTypes";

class GenerateMessageRepo {
    async generateMessage(userId: string, parsedData: generateMessageSchemaType) {
        try {
            const data = prismaClient.$transaction(async tx => {
                let newCompanyData;
                if (parsedData.isNewCompany) {
                    newCompanyData = await tx.company.create({
                        data: {
                            name: parsedData.newCompanyName!,
                            createdBy: userId
                        }
                    })
                }

                await tx.generatedMessages.create({
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
            })
        }
        catch (error) {
            throw new Error(`Error at generating message ${error}`)
        }
    }
    async getGeneratedMessages(userId: string) {
        try {
            const data = await prismaClient.generatedMessages.findMany({
                where: { user: userId },
                orderBy: {
                    createdAt: 'desc'
                }
            })
            return data
        }
        catch (error) {
            throw new Error(`Error at getting generated messages ${error}`)
        }
    }
}

export default new GenerateMessageRepo();