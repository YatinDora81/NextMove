import {z} from 'zod'

export type Role = {
    id: string
    name: string
    description?: string
    createdAt: string
}

export const roleRelationSchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string().nullable(),
});

export const ruleSchema = z.object({
  id: z.string()    ,
  rule: z.string(),
  templateId: z.string(),
});

export const TemplateSchema = z.object({
    id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.literal("MESSAGE"),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
    role: z.string(),
  user: z.string(),
  isDeleted: z.boolean(),
  roleRelation: roleRelationSchema,
  rules: z.array(ruleSchema),
});

export type TemplateType = z.infer<typeof TemplateSchema>;
