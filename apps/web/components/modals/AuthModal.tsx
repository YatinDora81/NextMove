"use client"
import { useState, useRef } from "react"
import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import Image from "next/image"
import { useAuth } from "@/hooks/useAuth"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"
import { AUTH_LOGIN, AUTH_SIGNUP, AUTH_FORGOT_PASSWORD, AUTH_VERIFY_OTP, AUTH_CHANGE_PASSWORD } from "@/utils/url"
import { setAuthCookiesAction } from "@/lib/auth-actions"

type PopUpType = "login" | "signup" | "forgot-password" | null

type Props = {
    popup: PopUpType
    setPopup: (popup: PopUpType) => void
    redirectUrl?: string | null
}

function GoogleIcon() {
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
            />
            <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
            />
            <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
            />
            <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
            />
        </svg>
    )
}

function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div className="text-center mb-6">
            <div className="flex justify-center items-center gap-2 mb-3">
                <Image src="/logo.png" alt="NextMove" width={28} height={28} />
                <span className="font-semibold">NextMove</span>
            </div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
    )
}

function Divider() {
    return (
        <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
        </div>
    )
}

export default function AuthModal({ popup, setPopup, redirectUrl }: Props) {
    const isOpen = popup === "login" || popup === "signup" || popup === "forgot-password"

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && setPopup(null)}>
            <DialogContent className="sm:max-w-[400px] p-8">
                {popup === "login" && <LoginForm setPopup={setPopup} redirectUrl={redirectUrl} />}
                {popup === "signup" && <SignupForm setPopup={setPopup} redirectUrl={redirectUrl} />}
                {popup === "forgot-password" && <ForgotPasswordForm setPopup={setPopup} />}
            </DialogContent>
        </Dialog>
    )
}

function LoginForm({ setPopup, redirectUrl }: { setPopup: (p: PopUpType) => void; redirectUrl?: string | null }) {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleGoogleLogin = () => {
        toast.error("Google login not implemented yet")
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !password) {
            toast.error("Please fill in all fields")
            return
        }
        setLoading(true)
        try {
            // Direct client-side API call (like forgot password)
            const res = await fetch(AUTH_LOGIN, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            })
            const data = await res.json()
            
            if (data.success) {
                // Set cookies via server action
                await setAuthCookiesAction(data.data.token, data.data.user)
                toast.success("Logged in successfully!")
                setPopup(null)
                // Use window.location for full page reload to pick up server-side cookies
                if (redirectUrl) {
                    window.location.href = redirectUrl
                } else {
                    window.location.reload()
                }
            } else {
                toast.error(data.message || "Failed to login")
            }
        } catch {
            toast.error("Failed to login")
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <AppHeader 
                title="Sign in to NextMove" 
                subtitle={redirectUrl ? "Sign in to continue to your page" : "Welcome back! Please sign in to continue"}
            />

            {redirectUrl && (
                <p className="text-xs text-center text-muted-foreground -mt-4 mb-4">
                    You&apos;ll be redirected to <span className="font-medium text-foreground">{redirectUrl}</span>
                </p>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Email address</Label>
                    <Input
                        type="email"
                        placeholder="Enter your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-10"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Password</Label>
                    <Input
                        type="password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-10"
                    />
                </div>

                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={() => setPopup("forgot-password")}
                        className="text-sm text-primary hover:underline"
                    >
                        Forgot password?
                    </button>
                </div>

                <Button type="submit" className="w-full h-10" disabled={loading}>
                    {loading ? "Signing in..." : "Continue"}
                </Button>
            </form>

            {/* Google Login - Not implemented yet
            <Divider />

            <Button 
                variant="outline" 
                className="w-full h-10 gap-3 font-normal"
                onClick={handleGoogleLogin}
                disabled={loading}
            >
                <GoogleIcon />
                Continue with Google
            </Button>
            */}

            <p className="text-center text-sm text-muted-foreground mt-6">
                Don&apos;t have an account?{" "}
                <button 
                    onClick={() => setPopup("signup")} 
                    className="text-primary font-medium hover:underline"
                >
                    Sign up
                </button>
            </p>
        </>
    )
}

function SignupForm({ setPopup, redirectUrl }: { setPopup: (p: PopUpType) => void; redirectUrl?: string | null }) {
    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleGoogleSignup = () => {
        toast.error("Google signup not implemented yet")
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name || !email || !password) {
            toast.error("Please fill in all fields")
            return
        }
        setLoading(true)
        try {
            const nameParts = name.trim().split(" ")
            const firstName = nameParts[0]
            const lastName = nameParts.slice(1).join(" ") || ""

            // Direct client-side API call (like forgot password)
            const res = await fetch(AUTH_SIGNUP, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ firstName, lastName, email, password })
            })
            const data = await res.json()
            
            if (data.success) {
                // Set cookies via server action
                await setAuthCookiesAction(data.data.token, data.data.user)
                toast.success("Account created successfully!")
                setPopup(null)
                // Use window.location for full page reload to pick up server-side cookies
                if (redirectUrl) {
                    window.location.href = redirectUrl
                } else {
                    window.location.reload()
                }
            } else {
                toast.error(data.message || "Failed to create account")
            }
        } catch {
            toast.error("Failed to create account")
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <AppHeader 
                title="Create your account" 
                subtitle={redirectUrl ? "Create an account to continue" : "Welcome! Please fill in the details to get started"}
            />

            {redirectUrl && (
                <p className="text-xs text-center text-muted-foreground -mt-4 mb-4">
                    You&apos;ll be redirected to <span className="font-medium text-foreground">{redirectUrl}</span>
                </p>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Full name</Label>
                    <Input
                        type="text"
                        placeholder="Enter your full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-10"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Email address</Label>
                    <Input
                        type="email"
                        placeholder="Enter your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-10"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-sm font-medium">Password</Label>
                    <Input
                        type="password"
                        placeholder="Create a password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-10"
                    />
                </div>

                <Button type="submit" className="w-full h-10" disabled={loading}>
                    {loading ? "Creating account..." : "Continue"}
                </Button>
            </form>

            {/* Google Signup - Not implemented yet
            <Divider />

            <Button 
                variant="outline" 
                className="w-full h-10 gap-3 font-normal"
                onClick={handleGoogleSignup}
                disabled={loading}
            >
                <GoogleIcon />
                Continue with Google
            </Button>
            */}

            <p className="text-center text-sm text-muted-foreground mt-6">
                Already have an account?{" "}
                <button 
                    onClick={() => setPopup("login")} 
                    className="text-primary font-medium hover:underline"
                    disabled={loading}
                >
                    Sign in
                </button>
            </p>
        </>
    )
}

function ForgotPasswordForm({ setPopup }: { setPopup: (p: PopUpType) => void }) {
    const [step, setStep] = useState<"email" | "otp" | "password">("email")
    const [email, setEmail] = useState("")
    const [otp, setOtp] = useState(["", "", "", "", "", ""])
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [resetToken, setResetToken] = useState("")
    const [loading, setLoading] = useState(false)
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email) {
            toast.error("Email is required")
            return
        }
        setLoading(true)
        try {
            const res = await fetch(AUTH_FORGOT_PASSWORD, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("OTP sent to your email")
                setStep("otp")
            } else {
                toast.error(data.message || "Failed to send OTP")
            }
        } catch {
            toast.error("Failed to send OTP")
        } finally {
            setLoading(false)
        }
    }

    const handleOtpChange = (index: number, value: string) => {
        if (value.length > 1) value = value[0] || ""
        if (!/^\d*$/.test(value)) return

        const newOtp = [...otp]
        newOtp[index] = value
        setOtp(newOtp)

        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus()
        }
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === "Backspace" && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus()
        }
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pastedData = e.clipboardData.getData("text").slice(0, 6)
        if (!/^\d+$/.test(pastedData)) return

        const newOtp = [...otp]
        pastedData.split("").forEach((char, i) => {
            if (i < 6) newOtp[i] = char
        })
        setOtp(newOtp)
        inputRefs.current[Math.min(pastedData.length, 5)]?.focus()
    }

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        const otpValue = otp.join("")
        if (otpValue.length !== 6) {
            toast.error("Please enter complete OTP")
            return
        }
        setLoading(true)
        try {
            const res = await fetch(AUTH_VERIFY_OTP, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, otp: otpValue })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("OTP verified")
                setResetToken(data.data.resetToken)
                setStep("password")
            } else {
                toast.error(data.message || "Invalid OTP")
            }
        } catch {
            toast.error("Failed to verify OTP")
        } finally {
            setLoading(false)
        }
    }

    const handleResendOtp = async () => {
        setLoading(true)
        try {
            const res = await fetch(AUTH_FORGOT_PASSWORD, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("OTP resent to your email")
                setOtp(["", "", "", "", "", ""])
            } else {
                toast.error(data.message || "Failed to resend OTP")
            }
        } catch {
            toast.error("Failed to resend OTP")
        } finally {
            setLoading(false)
        }
    }

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match")
            return
        }
        if (newPassword.length < 6) {
            toast.error("Password must be at least 6 characters")
            return
        }
        setLoading(true)
        try {
            const res = await fetch(AUTH_CHANGE_PASSWORD, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, resetToken, newPassword })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("Password changed successfully")
                setPopup("login")
            } else {
                toast.error(data.message || "Failed to change password")
            }
        } catch {
            toast.error("Failed to change password")
        } finally {
            setLoading(false)
        }
    }

    // Step 3: New Password
    if (step === "password") {
        return (
            <>
                <div className="text-center mb-6">
                    <div className="flex justify-center items-center gap-2 mb-3">
                        <Image src="/logo.png" alt="NextMove" width={28} height={28} />
                        <span className="font-semibold">NextMove</span>
                    </div>
                    <h2 className="text-xl font-semibold">Set new password</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Your new password must be different from previous passwords
                    </p>
                </div>

                <form className="space-y-4" onSubmit={handleResetPassword}>
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">New password</Label>
                        <Input
                            type="password"
                            placeholder="Enter new password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="h-10"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Confirm password</Label>
                        <Input
                            type="password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="h-10"
                            required
                        />
                    </div>

                    <Button type="submit" className="w-full h-10" disabled={loading}>
                        {loading ? "Resetting..." : "Reset password"}
                    </Button>

                    <button
                        type="button"
                        onClick={() => setPopup("login")}
                        className="w-full text-sm text-muted-foreground hover:underline flex items-center justify-center gap-1"
                        disabled={loading}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to sign in
                    </button>
                </form>
            </>
        )
    }

    // Step 2: OTP
    if (step === "otp") {
        return (
            <>
                <div className="text-center mb-6">
                    <div className="flex justify-center items-center gap-2 mb-3">
                        <Image src="/logo.png" alt="NextMove" width={28} height={28} />
                        <span className="font-semibold">NextMove</span>
                    </div>
                    <h2 className="text-xl font-semibold">Check your email</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Enter the 6-digit code sent to
                    </p>
                    <p className="text-sm font-medium">{email}</p>
                </div>

                <form className="space-y-6" onSubmit={handleVerifyOtp}>
                    <div className="flex justify-center gap-2">
                        {otp.map((digit, index) => (
                            <input
                                key={index}
                                ref={(el) => { inputRefs.current[index] = el }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleOtpChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                onPaste={handlePaste}
                                className="w-10 h-12 text-center text-lg font-semibold border rounded-lg bg-background focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            />
                        ))}
                    </div>

                    <Button type="submit" className="w-full h-10" disabled={loading}>
                        {loading ? "Verifying..." : "Verify"}
                    </Button>

                    <div className="text-center space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Didn&apos;t receive the code?{" "}
                            <button
                                type="button"
                                onClick={handleResendOtp}
                                className="text-primary font-medium hover:underline"
                                disabled={loading}
                            >
                                Resend
                            </button>
                        </p>
                        <button
                            type="button"
                            onClick={() => setStep("email")}
                            className="text-sm text-muted-foreground hover:underline"
                            disabled={loading}
                        >
                            Use different email
                        </button>
                    </div>
                </form>
            </>
        )
    }

    return (
        <>
            <div className="text-center mb-6">
                <div className="flex justify-center items-center gap-2 mb-3">
                    <Image src="/logo.png" alt="NextMove" width={28} height={28} />
                    <span className="font-semibold">NextMove</span>
                </div>
                <h2 className="text-xl font-semibold">Forgot password?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    No worries, we&apos;ll send you reset instructions
                </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Email address</Label>
                    <Input
                        type="email"
                        placeholder="Enter your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-10"
                        required
                    />
                </div>

                <Button type="submit" className="w-full h-10" disabled={loading}>
                    {loading ? "Sending..." : "Send reset code"}
                </Button>

                <button
                    type="button"
                    onClick={() => setPopup("login")}
                    className="w-full text-sm text-muted-foreground hover:underline flex items-center justify-center gap-1"
                    disabled={loading}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to sign in
                </button>
            </form>
        </>
    )
}
