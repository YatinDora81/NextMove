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