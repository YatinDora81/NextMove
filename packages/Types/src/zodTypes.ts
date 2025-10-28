import { z } from 'zod';

export const authTokenSchema = z.object({
    azp: z.string(),
    email: z.string(),
    exp: z.number(),
    full_name: z.string(),
    iat: z.number(),
    image_url: z.string(),
    iss: z.string(),
    jti: z.string(),
    nbf: z.number(),
    phone_number: z.string().nullable(),
    sub: z.string(),
    user_id: z.string(),
})

export type authTokenSchemaType = z.infer<typeof authTokenSchema>;

export const createUserSchema = z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    email: z.email(),
    profilePic: z.string().nullable(),
})

export type createUserSchemaType = z.infer<typeof createUserSchema>;

export const createTemplateSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    type: z.enum(['MESSAGE', 'EMAIL']),
    content: z.string(),
    role: z.string(),
    rules: z.array(z.string()),
})
export type createTemplateSchemaType = z.infer<typeof createTemplateSchema>;

export const deleteTemplateSchema = z.object({
    templateId: z.string(),
})
export type deleteTemplateSchemaType = z.infer<typeof deleteTemplateSchema>;

export const updateTemplateSchema = z.object({
    templateId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.enum(['MESSAGE', 'EMAIL']),
    content: z.string(),
    role: z.string(),
    isRulesChanged: z.boolean(),
    rules: z.array(z.string()),
})
export type updateTemplateSchemaType = z.infer<typeof updateTemplateSchema>;

export const updateUserDetailsSchema = z.object({
    firstName: z.string(),
    lastName: z.string().nullable().default(""),
    image_url: z.string().nullable(),
    userId: z.string(),
})
export type updateUserDetailsSchemaType = z.infer<typeof updateUserDetailsSchema>;

export const deleteUserSchema = z.object({
    userId: z.string(),
})
export type deleteUserSchemaType = z.infer<typeof deleteUserSchema>;

export const createRoleSchema = z.array(z.string());
export type createRoleSchemaType = z.infer<typeof createRoleSchema>;

export const deleteRoleSchema = z.array(z.string());
export type deleteRoleSchemaType = z.infer<typeof deleteRoleSchema>;

export const generateMessageSchema = z.object({
    recruiterName: z.string(),
    role: z.string(),
    template: z.string(),
    company: z.string(),
    message: z.string(),
    gender: z.string().optional().default(""),
    messageType: z.enum(['MESSAGE', 'EMAIL']),
    isNewCompany: z.boolean().optional().default(false),
    newCompanyName: z.string().optional().default(""),
    isNewRecruiter: z.boolean().optional().default(false),
})
export type generateMessageSchemaType = z.infer<typeof generateMessageSchema>;

export const getGeneratedMessagesSchema = z.object({
    page: z.number(),
    limit: z.number()
})
export type getGeneratedMessagesSchemaType = z.infer<typeof getGeneratedMessagesSchema>;

export const updatePremiumSchema = z.array(z.email());
export type updatePremiumSchemaType = z.infer<typeof updatePremiumSchema>;

export const createChatSchema = z.object({
    isNewRoom: z.boolean().optional().default(false),
    predefinedMessages: z.array(z.string()),
    message: z.string(),
    roomId: z.string().nullable(),
    roomAllMessages: z.array(z.string()).optional().default([])
});
export type createChatSchemaType = z.infer<typeof createChatSchema>;
