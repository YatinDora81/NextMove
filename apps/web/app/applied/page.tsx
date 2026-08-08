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

/**
 * JF-001 SEC 8.5 — the unified Applied dashboard.
 *
 * The outreach half is still fetched on the server exactly as before (same token, same
 * endpoint, same error surface); the applications half loads client-side from
 * `/api/job-applications` because it is filtered, paginated and mutable.
 */
export default async function Applied() {
    const token = await getServerToken()

    if (!token) {
        redirect("/?popup=login&redirect_url=/applied")
    }

    const res = await fetch(GET_GENERATED_MESSAGES, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    })
    const data = await res.json()

    if (!data.success) {
        return <div>Error: {data.message}</div>
    }

    return (
        <Suspense fallback={null}>
            <AppliedTabs messages={data.data as GeneratedMessage[]} />
        </Suspense>
    )
}

export const dynamic = 'force-dynamic';
