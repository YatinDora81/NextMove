"use client"
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from '@clerk/nextjs'
import React, { useState } from 'react'
import { Navbar, NavItems, NavbarLogo, NavBody, MobileNav, MobileNavToggle, MobileNavHeader, MobileNavMenu, } from './ui/resizable-navbar'
import { Button } from './ui/button'
import { ModeToggle } from './ui/modeToggle'


function NextMove_Navbar() {

    const { isSignedIn, user } = useUser()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const navbarItems: { name: string; link: string }[] = [
        { name: 'Generate', link: '/' },
        { name: 'AI Chat', link: '/ai-chat' },
        { name: 'Templates', link: '/templates' },
        { name: 'Resumes', link: '/resumes' },
        { name: 'Companies', link: '/companies' },
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
                            <span className="text-sm capitalize font-mono">{user.firstName}</span>
                            <SignedIn>
                                <UserButton />
                            </SignedIn>
                        </div>
                    ) : (
                        // User is NOT logged in - show login/signup
                        <div className="flex items-center gap-2">
                            <SignedOut>
                                <SignInButton mode="modal">
                                    <Button variant="outline">Login</Button>
                                </SignInButton>

                                <SignUpButton forceRedirectUrl={"/?isu=1"} mode="modal">
                                    <Button variant="default">Sign Up</Button>
                                </SignUpButton>
                            </SignedOut>

                        </div>
                    )}
                </div>

            </NavBody>

            <MobileNav>
                <MobileNavHeader>
                    <NavbarLogo />
                    <div className=' flex justify-center items-center gap-3'>
                        <MobileNavToggle
                            isOpen={isMobileMenuOpen}
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        />
                        <ModeToggle />


                        {isSignedIn && <div className="flex items-center gap-2">
                            <SignedIn>
                                <UserButton />
                            </SignedIn>
                        </div>}
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
                                <SignedOut>
                                    <SignInButton mode="modal">
                                        <Button variant="outline">Login</Button>
                                    </SignInButton>

                                    <SignUpButton mode="modal">
                                        <Button variant="default">Sign Up</Button>
                                    </SignUpButton>
                                </SignedOut>

                            </div>
                        )}
                    </div>
                    {isSignedIn && navbarItems.map((item, idx) => (
                        <a
                            key={`mobile-link-${idx}`}
                            href={item.link}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="relative text-neutral-600 dark:text-neutral-300"
                        >
                            <span className="block">{item.name}</span>
                        </a>
                    ))}

                </MobileNavMenu>
            </MobileNav>
        </Navbar>
    )
}

export default NextMove_Navbar
