import type { Metadata } from 'next';
import { Suspense } from 'react';
import AppliedTabs from "@/app/applied/AppliedTabs";
import { GET_GENERATED_MESSAGES } from "@/utils/url";
import { GeneratedMessage } from "@/utils/api_types";
import { getServerToken } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: 'Applied Jobs | NextMoveApp',
    description: 'View all your job applications and track their status',
};

/** Shown when the outreach call fails without handing us an envelope message of its own. */
const OUTREACH_FALLBACK_MESSAGE = "We couldn't load your outreach messages. Everything else on this page still works."

type OutreachResult = {
    messages: GeneratedMessage[]
    /** Non-null when the outreach fetch failed; the outreach tab renders it inline. */
    error: string | null
}

/**
 * The Applied page has two independent sources: outreach (fetched here) and the
 * extension-tracked applications (fetched from the client by ApplicationsDashboard).
 * Outreach used to fail closed and replace the whole page, hiding applications that had
 * loaded perfectly well — so every failure mode (transport error, 5xx, HTML error page
 * instead of JSON, `success: false`) is folded into an inline message instead.
 */
async function loadOutreach(token: string): Promise<OutreachResult> {
    try {
        const res = await fetch(GET_GENERATED_MESSAGES, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        })

        // Gateways answer 5xx with HTML, so json() is a throwing call on the sad path.
        const payload: unknown = await res.json().catch(() => null)
        const envelope = typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : null
        const message = typeof envelope?.message === "string" && envelope.message.trim() !== ""
            ? envelope.message
            : null

        if (!res.ok || envelope === null || envelope.success !== true) {
            return { messages: [], error: message ?? OUTREACH_FALLBACK_MESSAGE }
        }

        return {
            messages: Array.isArray(envelope.data) ? (envelope.data as GeneratedMessage[]) : [],
            error: null,
        }
    } catch {
        return { messages: [], error: OUTREACH_FALLBACK_MESSAGE }
    }
}

export default async function Applied() {
    const token = await getServerToken()

    if (!token) {
        redirect("/?popup=login&redirect_url=/applied")
    }

    const outreach = await loadOutreach(token)

    return (
        <Suspense fallback={null}>
            <AppliedTabs messages={outreach.messages} outreachError={outreach.error} />
        </Suspense>
    )
}

export const dynamic = 'force-dynamic';
