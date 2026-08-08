"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Menu, X } from "lucide-react"
import { useAuth, useUser } from "@/hooks/useAuth"
import { usePopUp } from "@/hooks/usePopUp"
import { ModeToggle } from "./ui/modeToggle"
import { Logo } from "./quiet/Logo"
import { Button } from "./quiet/Button"
import { cn } from "@/lib/utils"

const marketingLinks: { name: string; link: string }[] = [
    { name: "Product", link: "/#product" },
    { name: "Privacy", link: "/#privacy" },
    { name: "Extension", link: "/extension" },
]

const appLinks: { name: string; link: string }[] = [
    { name: "Generate", link: "/generate" },
    { name: "Templates", link: "/templates" },
    { name: "Applied", link: "/applied" },
    { name: "AI Chat", link: "/ai-chat" },
]

function NextMove_Navbar() {
    const { user, isSignedIn } = useUser()
    const { signOut } = useAuth()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const { setPopup } = usePopUp()
    const router = useRouter()
    const pathname = usePathname()

    const handleSignOut = async () => {
        setIsMobileMenuOpen(false)
        await signOut()
        router.refresh()
        router.push("/")
    }

    const items = isSignedIn ? appLinks : marketingLinks
    const initial = (user?.firstName ?? user?.email ?? "U").trim().charAt(0).toUpperCase()

    const isActive = (link: string) => !link.includes("#") && pathname.startsWith(link)

    return (
        <header className="sticky top-0 z-40 w-full border-b border-hair bg-surface">
            <div className="mx-auto flex max-w-[1120px] items-center gap-2.5 px-6 py-3.5">
                <Link href="/" className="flex items-center gap-2.5">
                    <Logo />
                    <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg">NextMove</span>
                </Link>

                <nav className="ml-4 flex gap-0.5 max-md:hidden">
                    {items.map((item) => (
                        <Link
                            key={item.link}
                            href={item.link}
                            className={cn(
                                "rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                                isActive(item.link)
                                    ? "bg-well text-fg"
                                    : "text-fg2 hover:bg-well hover:text-fg"
                            )}
                        >
                            {item.name}
                        </Link>
                    ))}
                </nav>

                <div className="ml-auto flex items-center gap-2">
                    <ModeToggle className="size-8 rounded-lg border-0 bg-transparent text-fg2 shadow-none hover:bg-well hover:text-fg dark:bg-transparent dark:hover:bg-well" />

                    {isSignedIn ? (
                        <div className="flex items-center gap-2 max-md:hidden">
                            <span className="flex size-7 items-center justify-center rounded-full bg-well2 text-xs font-semibold text-fg2">
                                {initial}
                            </span>
                            <span className="text-[13px] text-fg2 capitalize">{user?.firstName}</span>
                            <Button onClick={handleSignOut} className="px-3 py-1.5 text-[13px]">
                                Log out
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 max-md:hidden">
                            <Button variant="ghost" onClick={() => setPopup("login")} className="px-3 py-1.5">
                                Log in
                            </Button>
                            <Button variant="acc" onClick={() => setPopup("signup")} className="px-3.5 py-1.5">
                                Get started
                            </Button>
                        </div>
                    )}

                    <button
                        type="button"
                        aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                        aria-expanded={isMobileMenuOpen}
                        onClick={() => setIsMobileMenuOpen((open) => !open)}
                        className="rounded-lg p-1.5 text-fg2 transition-colors hover:bg-well hover:text-fg md:hidden"
                    >
                        {isMobileMenuOpen ? (
                            <X className="size-[18px]" strokeWidth={1.5} />
                        ) : (
                            <Menu className="size-[18px]" strokeWidth={1.5} />
                        )}
                    </button>
                </div>
            </div>

            {isMobileMenuOpen && (
                <div className="border-t border-hair bg-surface px-6 py-3 md:hidden">
                    <nav className="flex flex-col gap-0.5">
                        {items.map((item) => (
                            <Link
                                key={item.link}
                                href={item.link}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={cn(
                                    "rounded-lg px-3 py-2 text-[13.5px] font-medium",
                                    isActive(item.link) ? "bg-well text-fg" : "text-fg2"
                                )}
                            >
                                {item.name}
                            </Link>
                        ))}
                    </nav>

                    <div className="mt-3 flex items-center gap-2 border-t border-hair pt-3">
                        {isSignedIn ? (
                            <>
                                <span className="flex size-7 items-center justify-center rounded-full bg-well2 text-xs font-semibold text-fg2">
                                    {initial}
                                </span>
                                <span className="text-[13px] text-fg2 capitalize">{user?.firstName}</span>
                                <Button onClick={handleSignOut} className="ml-auto px-3 py-1.5 text-[13px]">
                                    Log out
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setIsMobileMenuOpen(false)
                                        setPopup("login")
                                    }}
                                    className="flex-1 py-2"
                                >
                                    Log in
                                </Button>
                                <Button
                                    variant="acc"
                                    onClick={() => {
                                        setIsMobileMenuOpen(false)
                                        setPopup("signup")
                                    }}
                                    className="flex-1 py-2"
                                >
                                    Get started
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </header>
    )
}

export default NextMove_Navbar
