"use client"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { createContext, useContext } from "react"
import AuthModal from "../components/modals/AuthModal"

/**
 * Popup values:
 * - "login"           → Opens login modal
 * - "signup"          → Opens signup modal
 * - "forgot-password" → Opens forgot password / OTP modal
 * - null              → Closes modal
 * 
 * URL params:
 * - popup       → Current popup type
 * - redirect_url → URL to redirect after successful login
 */
type PopUpType = "login" | "signup" | "forgot-password" | null

type PopUpContextType = {
    popup: PopUpType
    setPopup: (popup: PopUpType) => void
    redirectUrl: string | null
    redirectAfterAuth: () => void
}

const PopUpContext = createContext<PopUpContextType | null>(null)

export const PopUpProvider = ({ children }: { children: React.ReactNode }) => {
    const searchParams = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()

    const popup = (searchParams.get("popup") as PopUpType) || null
    const redirectUrl = searchParams.get("redirect_url")

    const setPopup = (value: PopUpType) => {
        const params = new URLSearchParams()
        if (value) {
            params.set("popup", value)
        }
        // Preserve redirect_url when switching between login/signup
        if (redirectUrl && (value === "login" || value === "signup")) {
            params.set("redirect_url", redirectUrl)
        }
        const query = params.toString()
        router.push(query ? `${pathname}?${query}` : pathname)
    }

    // Call this after successful authentication to redirect
    const redirectAfterAuth = () => {
        if (redirectUrl) {
            router.push(redirectUrl)
        } else {
            router.push(pathname)
        }
    }

    return (
        <PopUpContext.Provider value={{ popup, setPopup, redirectUrl, redirectAfterAuth }}>
            {children}
            <AuthModal popup={popup} setPopup={setPopup} redirectUrl={redirectUrl} />
        </PopUpContext.Provider>
    )
}

export const usePopUp = () => {
    const context = useContext(PopUpContext)
    if (!context) {
        throw new Error("usePopUp must be used within a PopUpProvider")
    }
    return context
}
