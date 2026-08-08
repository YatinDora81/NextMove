"use client"

/**
 * JF-001 SEC 15.2 (honest limit) / 15.7 — the disclosure that has to sit next to the paste field.
 *
 * We do not pretend the web vault is zero-trust. It cannot be: web AI features run inside
 * apps/http-server, so the server reads the key at call time to make the call. What we do
 * promise is the part that is actually true — encrypted at rest with a master key held outside
 * the database, never returned by any route, never logged.
 */

import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export function HonestLimitsNotice({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm",
                className,
            )}
        >
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">Where this key lives.</span>{" "}
                NextMove&apos;s web AI runs on our server, so the server can read your key at call time
                to make the call for you. It is encrypted at rest with AES-256-GCM using a master key
                held outside the database, no endpoint or log line ever returns it, and there is no
                reveal button anywhere in this product. Delete it here at any time and the stored
                ciphertext is destroyed immediately.{" "}
                <Link
                    href="/#privacy"
                    className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                >
                    Read the privacy policy
                </Link>
                .
            </p>
        </div>
    )
}
