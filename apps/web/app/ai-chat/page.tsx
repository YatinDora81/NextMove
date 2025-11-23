"use client"

import { AIProvider } from "@/hooks/useAI";
import AiChatPage from "@/ui-pages/AIChatPage";

export default function AIChat() {
    return (
        <AIProvider>
            <AiChatPage />
        </AIProvider>
    )
}