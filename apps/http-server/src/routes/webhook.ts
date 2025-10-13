import express, { Router } from "express";
import crypto from "crypto";

const router: Router = express.Router();


router.post(
    "/clerk",
    express.raw({ type: "application/json" }),
    (req, res) => {
        try {
            // console.log(req)
            const signature = req.headers["clerk-signature"];
            const rawBody = req.body; // now Buffer (not parsed JSON)
            const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

            const expectedSignature = crypto
                .createHmac("sha256", CLERK_WEBHOOK_SECRET!)
                .update(rawBody)
                .digest("hex");

            if (signature !== expectedSignature) {
                console.log("❌ Invalid signature");
                return res.status(401).json({ error: "Invalid signature" });
            }

            const event = JSON.parse(rawBody.toString());

            switch (event.type) {
                case "user.created":
                    console.log("🟢 New user created:", event.data);
                    break;
                case "user.updated":
                    console.log("🟡 User updated:", event.data);
                    break;
                case "user.deleted":
                    console.log("🔴 User deleted:", event.data);
                    break;
                default:
                    console.log("⚪ Unhandled event:", event.type);
            }

            return res.status(200).json({ received: true });
        } catch (err) {
            console.error("❌ Webhook error:", err);
            return res.status(400).json({ error: "Invalid payload" });
        }
    }
);

export default router;
