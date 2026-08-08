import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE_NAME = "nextmove_auth_token"

// `/extension` itself stays public — it is the pre-install marketing page and a signed-out
// visitor must be able to read it. `/extension/connect` is the handshake and needs an account, so
// the exact subpath is listed instead. Adding '/extension' here would break the public page,
// because the check below is a prefix match.
const protectedRoutes = [
    '/dashboard',
    '/forum',
    '/generate',
    '/on-boarding',
    '/onboarding',
    '/templates',
    '/applied',
    '/ai-chat',
    '/extension/connect',
]

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value

    // Check if the route is protected
    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

    if (isProtectedRoute && !token) {
        // Redirect to home with login popup and redirect_url
        const redirectUrl = pathname + request.nextUrl.search
        const url = new URL('/', request.url)
        url.searchParams.set('popup', 'login')
        url.searchParams.set('redirect_url', redirectUrl)
        return NextResponse.redirect(url)
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
    ],
}
