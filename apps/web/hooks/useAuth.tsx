"use client"
import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { signInAction, signUpAction, signOutAction, getTokenAction } from "@/lib/auth-actions"

/**
 * Custom Auth Provider
 * Uses cookies for token storage (works on both client and server)
 * 
 * Client-side: useAuth() hook
 * Server-side: import from @/lib/auth
 */

type User = {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
}

type AuthResult = {
    success: boolean
    error?: string
}

type AuthContextType = {
    user: User | null
    isSignedIn: boolean
    isLoaded: boolean
    signIn: (email: string, password: string) => Promise<AuthResult>
    signUp: (name: string, email: string, password: string) => Promise<AuthResult>
    signOut: () => Promise<void>
    getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextType | null>(null)

const USER_COOKIE_NAME = "nextmove_user"

function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) return parts.pop()?.split(";").shift() || null
    return null
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)

    // Load user from cookie on mount
    useEffect(() => {
        const userCookie = getCookie(USER_COOKIE_NAME)
        if (userCookie) {
            try {
                setUser(JSON.parse(decodeURIComponent(userCookie)))
            } catch {
                setUser(null)
            }
        }
        setIsLoaded(true)
    }, [])

    const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
        const result = await signInAction(email, password)
        if (result.success) {
            // Reload user from cookie
            const userCookie = getCookie(USER_COOKIE_NAME)
            if (userCookie) {
                try {
                    setUser(JSON.parse(decodeURIComponent(userCookie)))
                } catch {
                    // Cookie might not be set yet, try again after a small delay
                    setTimeout(() => {
                        const retryUserCookie = getCookie(USER_COOKIE_NAME)
                        if (retryUserCookie) {
                            setUser(JSON.parse(decodeURIComponent(retryUserCookie)))
                        }
                    }, 100)
                }
            }
        }
        return result
    }, [])

    const signUp = useCallback(async (name: string, email: string, password: string): Promise<AuthResult> => {
        const result = await signUpAction(name, email, password)
        if (result.success) {
            const userCookie = getCookie(USER_COOKIE_NAME)
            if (userCookie) {
                try {
                    setUser(JSON.parse(decodeURIComponent(userCookie)))
                } catch {
                    setTimeout(() => {
                        const retryUserCookie = getCookie(USER_COOKIE_NAME)
                        if (retryUserCookie) {
                            setUser(JSON.parse(decodeURIComponent(retryUserCookie)))
                        }
                    }, 100)
                }
            }
        }
        return result
    }, [])

    const signOut = useCallback(async () => {
        await signOutAction()
        setUser(null)
    }, [])

    const getToken = useCallback(async (): Promise<string | null> => {
        return await getTokenAction()
    }, [])

    return (
        <AuthContext.Provider value={{
            user,
            isSignedIn: !!user,
            isLoaded,
            signIn,
            signUp,
            signOut,
            getToken,
        }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return context
}

// Convenience hook
export const useUser = () => {
    const { user, isSignedIn, isLoaded } = useAuth()
    return { user, isSignedIn, isLoaded }
}
