export type updateUserDetailsType = {
    firstName?: string
    lastName?: string
    image_url?: string | null
}
export type gptResponseType = {
    new_message: string
    name?: string
    description?: string
}