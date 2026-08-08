import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerToken } from "@/lib/auth"
import { ProfileVaultProvider } from "@/hooks/useProfileVault"
import { ConnectHandshake } from "@/app/extension/connect/ConnectHandshake"

/**
 * JF-001 SEC 8.2 — `/extension/connect`, the page a fresh install opens by itself.
 *
 * `onInstalled` in the extension mints a nonce and opens this URL with `?n=<nonce>&v=<version>`, so
 * for most users this is the very first NextMove screen they ever see. It is also reachable later
 * from Settings → Connected devices with no query string at all, in which case the page asks the
 * extension for a nonce instead.
 *
 * `noindex` because the URL is meaningless without a live nonce and a session.
 */

export const metadata: Metadata = {
    title: "Connect the extension | NextMoveApp",
    description:
        "Pair NextMove Autofill with your account in one click. Your encryption key is handed to the extension directly and never reaches our servers.",
    robots: { index: false, follow: false },
}

/** The handshake reads a live session and a live nonce, so nothing about it may be cached. */
export const dynamic = "force-dynamic"

export default async function ExtensionConnectPage({
    searchParams,
}: {
    searchParams: Promise<{ n?: string; v?: string }>
}) {
    const params = await searchParams
    const token = await getServerToken()

    if (!token) {
        // Carry the nonce through the login round trip. It is short-lived, but signing in takes
        // seconds — dropping it would force a second handshake for no reason.
        const query = new URLSearchParams()
        if (params.n !== undefined && params.n.length > 0) query.set("n", params.n)
        if (params.v !== undefined && params.v.length > 0) query.set("v", params.v)
        const target =
            query.size > 0 ? `/extension/connect?${query.toString()}` : "/extension/connect"
        redirect(`/?popup=login&redirect_url=${encodeURIComponent(target)}`)
    }

    return (
        <ProfileVaultProvider>
            <ConnectHandshake
                nonce={params.n !== undefined && params.n.length > 0 ? params.n : null}
                extensionVersion={params.v !== undefined && params.v.length > 0 ? params.v : null}
            />
        </ProfileVaultProvider>
    )
}
