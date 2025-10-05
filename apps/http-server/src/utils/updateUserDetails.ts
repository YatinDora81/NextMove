import { clerkClient } from "@/config/clerk.js";
import { updateUserDetailsType } from "@repo/types/Types";

export const updateUserDeatilsClerk = async (userId: string, data: updateUserDetailsType) => {
    try {
        const response = await clerkClient.users.updateUser(userId, data)
        return response;
    } catch (error) {
        throw new Error(`Failed to update user details , ${error}`)
    }
}