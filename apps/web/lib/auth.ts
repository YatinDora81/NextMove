import { cookies } from "next/headers"

const AUTH_COOKIE_NAME = "nextmove_auth_token"
const USER_COOKIE_NAME = "nextmove_user"

/**
 * Server-side auth utilities
 * Use these in Server Components and API routes
 */

export async function getServerToken(): Promise<string | null> {
    const cookieStore = await cookies()
    return cookieStore.get(AUTH_COOKIE_NAME)?.value || null
}

export async function getServerUser() {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get(USER_COOKIE_NAME)?.value
    if (!userCookie) return null
    
    try {
        return JSON.parse(userCookie)
    } catch {
        return null
    }
}

export async function isAuthenticated(): Promise<boolean> {
    const token = await getServerToken()
    return !!token
}

/**
 * Server action to set auth cookies
 */
export async function setAuthCookies(token: string, user: object) {
    const cookieStore = await cookies()
    
    // Set token cookie - httpOnly for security
    cookieStore.set(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
    })
    
    // Set user cookie - readable by client for UI
    cookieStore.set(USER_COOKIE_NAME, JSON.stringify(user), {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
    })
}

export async function clearAuthCookies() {
    const cookieStore = await cookies()
    cookieStore.delete(AUTH_COOKIE_NAME)
    cookieStore.delete(USER_COOKIE_NAME)
}
