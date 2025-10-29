import { AIProvider } from "@/hooks/useAI";
import AiChatPage from "@/pages/AIChatPage";

export default function AIChat() {
    return (
        <AIProvider>
            <AiChatPage />
        </AIProvider>
    )
}