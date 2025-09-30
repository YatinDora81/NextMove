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
    name: z.string(),
    email: z.email(),
    profilePic: z.string().nullable(),
})

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