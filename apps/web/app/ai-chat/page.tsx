import { AIProvider } from "@/hooks/useAI";
import AiChatPage from "@/pages/AIChatPage";
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AI Chat | NextMoveApp',
    description: 'Chat with AI to get help with your job applications',
};

export default function AIChat() {
    return (
        <AIProvider>
            <AiChatPage />
        </AIProvider>
    )
}

export const dynamic = 'force-dynamic';