import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
})

/**
 * Send OTP email for password reset
 */
export async function sendOTPEmail(email: string, otp: string, name: string) {
    const mailOptions = {
        from: `"NextMove" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Password Reset OTP - NextMove",
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
                <div style="background: #0a0a0a; padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">NextMove</h1>
                    <p style="color: #a0a0a0; margin: 8px 0 0 0; font-size: 14px;">Your Career, Your Next Move</p>
                </div>
                
                <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 12px 12px;">
                    <h2 style="color: #0a0a0a; margin-top: 0; font-size: 22px; font-weight: 600;">Password Reset Request</h2>
                    
                    <p style="color: #404040;">Hi ${name},</p>
                    
                    <p style="color: #404040;">We received a request to reset your password. Use the OTP below to verify your identity:</p>
                    
                    <div style="background: #fafafa; border: 2px solid #0a0a0a; border-radius: 12px; padding: 25px; text-align: center; margin: 30px 0;">
                        <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #0a0a0a; font-family: monospace;">${otp}</span>
                    </div>
                    
                    <p style="color: #666; font-size: 14px;">
                        <strong>⏱ This OTP will expire in 10 minutes.</strong>
                    </p>
                    
                    <p style="color: #666; font-size: 14px;">
                        If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">
                    
                    <p style="color: #a0a0a0; font-size: 12px; text-align: center; margin: 0;">
                        This is an automated message from NextMove.<br>Please do not reply to this email.
                    </p>
                </div>
                
                <p style="color: #a0a0a0; font-size: 11px; text-align: center; margin-top: 20px;">
                    © ${new Date().getFullYear()} NextMove. All rights reserved.
                </p>
            </body>
            </html>
        `,
    }

    await transporter.sendMail(mailOptions)
}

/**
 * Send generic email
 */
export async function sendEmail(to: string, subject: string, html: string) {
    const mailOptions = {
        from: `"NextMove" <${process.env.MAIL_USER}>`,
        to,
        subject,
        html,
    }

    await transporter.sendMail(mailOptions)
}
