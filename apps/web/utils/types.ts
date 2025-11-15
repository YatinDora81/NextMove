import {z} from 'zod'

export const templateSchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string(),
    description: z.string().nullable().optional(),
    type: z.enum(['MESSAGE', 'EMAIL']),
    content: z.string(),
    createdAt: z.date().optional().nullable(),
    updatedAt: z.date().optional().nullable(),
    role: z.string(),
    user: z.string(),
    isDeleted: z.boolean().optional().nullable(),
    rules: z.array(z.string()).optional().nullable(),
})