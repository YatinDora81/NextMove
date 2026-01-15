import AppliedPage from "@/ui-pages/AppliedPage";
import { GET_GENERATED_MESSAGES } from "@/utils/url";
import { GeneratedMessage } from "@/utils/api_types";
import type { Metadata } from 'next';
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
        return <div>Error: {data.message}</div>
    }

    return (
        <AppliedPage messages={data.data as GeneratedMessage[]} />
    )
}

export const dynamic = 'force-dynamic';
