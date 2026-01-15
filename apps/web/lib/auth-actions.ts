"use server"

import { cookies } from "next/headers"
import { AUTH_LOGIN, AUTH_SIGNUP, AUTH_FORGOT_PASSWORD, AUTH_VERIFY_OTP, AUTH_CHANGE_PASSWORD } from "@/utils/url"

const AUTH_COOKIE_NAME = "nextmove_auth_token"
const USER_COOKIE_NAME = "nextmove_user"

type AuthResult = { 
    success: boolean
    error?: string 
}

type OTPResult = {
    success: boolean
    error?: string
    resetToken?: string
}

/**
 * Server action: Sign in user
 */
export async function signInAction(email: string, password: string): Promise<AuthResult> {
    try {
        const res = await fetch(AUTH_LOGIN, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        })

        const data = await res.json()

        if (!data.success) {
            return { success: false, error: data.message }
        }

        // Set cookies
        const cookieStore = await cookies()
        
        cookieStore.set(AUTH_COOKIE_NAME, data.data.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7,
            path: "/",
        })

        cookieStore.set(USER_COOKIE_NAME, JSON.stringify(data.data.user), {
            httpOnly: false,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7,
            path: "/",
        })

        return { success: true }
    } catch (error) {
        return { success: false, error: (error as Error).message }
    }
}

/**
 * Server action: Sign up user
 */
export async function signUpAction(name: string, email: string, password: string): Promise<AuthResult> {
    try {
        const nameParts = name.trim().split(" ")
        const firstName = nameParts[0]
        const lastName = nameParts.slice(1).join(" ") || ""

        const res = await fetch(AUTH_SIGNUP, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName, lastName, email, password }),
        })

        const data = await res.json()

        if (!data.success) {
            return { success: false, error: data.message }
        }

        // Set cookies
        const cookieStore = await cookies()
        
        cookieStore.set(AUTH_COOKIE_NAME, data.data.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7,
            path: "/",
        })

        cookieStore.set(USER_COOKIE_NAME, JSON.stringify(data.data.user), {
            httpOnly: false,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7,
            path: "/",
        })

        return { success: true }
    } catch (error) {
        return { success: false, error: (error as Error).message }
    }
}

/**
 * Server action: Sign out user
 */
export async function signOutAction(): Promise<void> {
    const cookieStore = await cookies()
    cookieStore.delete(AUTH_COOKIE_NAME)
    cookieStore.delete(USER_COOKIE_NAME)
}

/**
 * Server action: Get token (for API calls from client)
 */
export async function getTokenAction(): Promise<string | null> {
    const cookieStore = await cookies()
    return cookieStore.get(AUTH_COOKIE_NAME)?.value || null
}

/**
 * Server action: Send forgot password OTP
 */
export async function forgotPasswordAction(email: string): Promise<AuthResult> {
    try {
        const res = await fetch(AUTH_FORGOT_PASSWORD, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        })

        const data = await res.json()

        if (!data.success) {
            return { success: false, error: data.message }
        }

        return { success: true }
    } catch (error) {
        return { success: false, error: (error as Error).message }
    }
}

/**
 * Server action: Verify OTP
 */
export async function verifyOTPAction(email: string, otp: string): Promise<OTPResult> {
    try {
        const res = await fetch(AUTH_VERIFY_OTP, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, otp }),
        })

        const data = await res.json()

        if (!data.success) {
            return { success: false, error: data.message }
        }

        return { success: true, resetToken: data.data.resetToken }
    } catch (error) {
        return { success: false, error: (error as Error).message }
    }
}

/**
 * Server action: Change password (after OTP verification)
 */
export async function changePasswordAction(email: string, resetToken: string, newPassword: string): Promise<AuthResult> {
    try {
        const res = await fetch(AUTH_CHANGE_PASSWORD, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, resetToken, newPassword }),
        })

        const data = await res.json()

        if (!data.success) {
            return { success: false, error: data.message }
        }

        return { success: true }
    } catch (error) {
        return { success: false, error: (error as Error).message }
    }
}
