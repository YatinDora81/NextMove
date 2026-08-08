"use client"

import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { Well } from "@/components/quiet/Card"
import { cn } from "@/lib/utils"

export function HonestLimitsNotice({ className }: { className?: string }) {
    return (
        <Well className={cn("flex items-start gap-3 px-4 py-3.5", className)}>
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg2" strokeWidth={1.5} />
            <p className="text-[13px] leading-relaxed text-fg2">
                <span className="font-medium text-fg">Where this key lives.</span>{" "}
                NextMove&apos;s web AI runs on our server, so the server can read your key at call time
                to make the call for you. It is encrypted at rest with AES-256-GCM using a master key
                held outside the database, no endpoint or log line ever returns it, and there is no
                reveal button anywhere in this product. Delete it here at any time and the stored
                ciphertext is destroyed immediately.{" "}
                <Link
                    href="/#privacy"
                    className="font-medium text-fg underline underline-offset-4 transition-colors hover:text-acc"
                >
                    Read the privacy policy
                </Link>
                .
            </p>
        </Well>
    )
}
