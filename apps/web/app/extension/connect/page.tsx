import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerToken } from "@/lib/auth"
import { ProfileVaultProvider } from "@/hooks/useProfileVault"
import { ConnectHandshake } from "@/app/extension/connect/ConnectHandshake"

export const metadata: Metadata = {
    title: "Connect the extension | NextMoveApp",
    description:
        "Pair NextMove Autofill with your account in one click. Your encryption key is handed to the extension directly and never reaches our servers.",
    robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function ExtensionConnectPage({
    searchParams,
}: {
    searchParams: Promise<{ n?: string; v?: string }>
}) {
    const params = await searchParams
    const token = await getServerToken()

    if (!token) {
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
