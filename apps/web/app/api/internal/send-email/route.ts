import { NextRequest, NextResponse } from "next/server"
import { sendEmail, sendOTPEmail } from "@/lib/email"

/**
 * Protected internal API for sending emails
 * Called by the Node.js backend
 * 
 * Protected with INTERNAL_API_SECRET
 * Backend sends this secret in x-internal-secret header
 */

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET

export async function POST(request: NextRequest) {
    try {
        // Verify internal secret
        const internalSecret = request.headers.get("x-internal-secret")
        
        if (!INTERNAL_API_SECRET) {
            console.error("INTERNAL_API_SECRET not configured")
            return NextResponse.json(
                { success: false, message: "Server configuration error" },
                { status: 500 }
            )
        }

        if (internalSecret !== INTERNAL_API_SECRET) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { type, to, subject, html, otp, name } = body

        if (!to) {
            return NextResponse.json(
                { success: false, message: "Recipient email is required" },
                { status: 400 }
            )
        }

        // Send based on type
        if (type === "otp") {
            if (!otp || !name) {
                return NextResponse.json(
                    { success: false, message: "OTP and name are required for OTP emails" },
                    { status: 400 }
                )
            }
            await sendOTPEmail(to, otp, name)
        } else if (type === "generic") {
            if (!subject || !html) {
                return NextResponse.json(
                    { success: false, message: "Subject and HTML are required for generic emails" },
                    { status: 400 }
                )
            }
            await sendEmail(to, subject, html)
        } else {
            return NextResponse.json(
                { success: false, message: "Invalid email type. Use 'otp' or 'generic'" },
                { status: 400 }
            )
        }

        return NextResponse.json({
            success: true,
            message: "Email sent successfully"
        })

    } catch (error) {
        console.error("Send email error:", error)
        return NextResponse.json(
            { success: false, message: "Failed to send email" },
            { status: 500 }
        )
    }
}
