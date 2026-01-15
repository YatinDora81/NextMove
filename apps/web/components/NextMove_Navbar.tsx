"use client"
import { useUser, useAuth } from '@/hooks/useAuth'
import React, { useState } from 'react'
import { Navbar, NavItems, NavbarLogo, NavBody, MobileNav, MobileNavToggle, MobileNavHeader, MobileNavMenu, } from './ui/resizable-navbar'
import { Button } from './ui/button'
import { ModeToggle } from './ui/modeToggle'
import Link from 'next/link'
import { usePopUp } from '@/hooks/usePopUp'
import { useRouter } from 'next/navigation'

function NextMove_Navbar() {
    const { user, isSignedIn } = useUser()
    const { signOut } = useAuth()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const { setPopup } = usePopUp()
    const router = useRouter()

    const handleSignOut = async () => {
        await signOut()
        router.refresh()
        router.push('/')
    }
    
    const navbarItems: { name: string; link: string }[] = [
        { name: 'Generate', link: '/generate' },
        { name: 'AI Chat', link: '/ai-chat' },
        { name: 'Templates', link: '/templates' },
        { name: 'Applied', link: '/applied' }
    ]

    return (
        <Navbar className='fixed inset-x-0 top-0 z-40 w-full'>
            {/* Desktop Navigation */}
            <NavBody>
                <NavbarLogo />
                {isSignedIn && <NavItems items={navbarItems} />}

                <div className="flex items-center gap-4 z-50">
                    <ModeToggle />
                    {isSignedIn ? (
                        // User is logged in - show profile/logout
                        <div className="flex items-center gap-2">
                            <span className="text-sm capitalize font-mono">{user?.firstName}</span>
                            <Button variant="outline" size="sm" onClick={handleSignOut}>
                                Logout
                            </Button>
                        </div>
                    ) : (
                        // User is NOT logged in - show login/signup
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => setPopup("login")}>Login</Button>
                            <Button variant="default" onClick={() => setPopup("signup")}>Sign Up</Button>
                        </div>
                    )}
                </div>
            </NavBody>

            <MobileNav>
                <MobileNavHeader>
                    <NavbarLogo />
                    <div className='flex justify-center items-center gap-3'>
                        <MobileNavToggle
                            isOpen={isMobileMenuOpen}
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        />
                        <ModeToggle />

                        {isSignedIn && (
                            <Button variant="outline" size="sm" onClick={handleSignOut}>
                                Logout
                            </Button>
                        )}
                    </div>
                </MobileNavHeader>

                <MobileNavMenu
                    isOpen={isMobileMenuOpen}
                    onClose={() => setIsMobileMenuOpen(false)}
                >
                    <div className="flex justify-end w-full items-center gap-4 z-50">
                        {!isSignedIn && (
                            // User is NOT logged in - show login/signup
                            <div className="flex items-center gap-2">
                                <Button variant="outline" onClick={() => setPopup("login")}>Login</Button>
                                <Button variant="default" onClick={() => setPopup("signup")}>Sign Up</Button>
                            </div>
                        )}
                    </div>
                    {isSignedIn && navbarItems.map((item, idx) => (
                        <Link
                            key={`mobile-link-${idx}`}
                            href={item.link}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="relative text-neutral-600 dark:text-neutral-300"
                        >
                            <span className="block">{item.name}</span>
                        </Link>
                    ))}
                </MobileNavMenu>
            </MobileNav>
        </Navbar>
    )
}

export default NextMove_Navbar
