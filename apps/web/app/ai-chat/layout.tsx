import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'AI Chat',
  description:
    'Chat with the NextMove AI assistant to generate personalized outreach, follow-ups, and application messages instantly.',
}

export default function AiChatLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}

