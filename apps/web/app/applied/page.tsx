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
        return (
            <div className="mx-auto w-full max-w-[980px] px-6 py-6">
                <div className="rounded-xl border border-dan/40 bg-danbg px-4 py-3 text-[13.5px] text-dan">
                    {data.message}
                </div>
            </div>
        )
    }

    return (
        <Suspense fallback={null}>
            <AppliedTabs messages={data.data as GeneratedMessage[]} />
        </Suspense>
    )
}

export const dynamic = 'force-dynamic';
