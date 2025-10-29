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


export const CompanyRelationSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdByRelation: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    email: z.string(),
    profilePic: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    isPaid: z.boolean(),
  }).optional(),
});

export const TemplateRelationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(["MESSAGE", "EMAIL"]),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  role: z.string(),
  user: z.string(),
  isDeleted: z.boolean(),
});

export const UserRelationSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string(),
  profilePic: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  isPaid: z.boolean(),
});

export const GeneratedMessageSchema = z.object({
  id: z.string(),
  recruiterName: z.string().nullable(),
  role: z.string(),
  template: z.string(),
  company: z.string(),
  message: z.string(),
  gender: z.string().nullable(),
  messageType: z.enum(["MESSAGE", "EMAIL"]),
  createdAt: z.date(),
  updatedAt: z.date(),
  user: z.string(),
  
  // Relations (populated by backend)
  roleRel: roleRelationSchema.optional(),
  templateRel: TemplateRelationSchema.optional(),
  company_gen_rel: CompanyRelationSchema.optional(),
  userGen: UserRelationSchema.optional(),
});

export type GeneratedMessageType = z.infer<typeof GeneratedMessageSchema>;
export type GeneratedMessage = GeneratedMessageType; // Alias for backward compatibility

export const MessageSchema = z.object({
  id: z.string(),
  message: z.string(),
  by: z.enum(["SELF", "AI"]),
  userId: z.string(),
  roomId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const RoomWithAIChateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  predefinedMessages: z.array(z.string()),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  messages: z.array(MessageSchema),
});

export type MessageType = z.infer<typeof MessageSchema>;
export type RoomWithAIChatType = z.infer<typeof RoomWithAIChateSchema>;