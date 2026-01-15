import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import NextMove_Navbar from '@/components/NextMove_Navbar'
import { ThemeAwareToaster } from '@/components/ThemeAwareToaster'
import { PopUpProvider } from '@/hooks/usePopUp'
import { AuthProvider } from '@/hooks/useAuth'
import { Suspense } from 'react'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'NextMoveApp | AI Job Application Assistant',
    template: '%s | NextMoveApp',
  },
  description:
    'NextMoveApp helps job seekers craft personalized applications, track progress, and collaborate with AI to land their next role faster.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <AuthProvider>
            <Suspense fallback={null}>
              <PopUpProvider>
                <NextMove_Navbar />
                {children}
                <ThemeAwareToaster />
              </PopUpProvider>
            </Suspense>
          </AuthProvider>
        </body>
      </ThemeProvider>
    </html>
  )
}