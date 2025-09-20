"use client"
import React, { useState, useEffect, useRef, useMemo } from "react"
import { Copy, Check, RotateCcw, Plus, MessageSquare, Menu, X } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Message = {
  id: number
  role: "user" | "ai" | "system"
  content: string
  type?: "text" | "options"
  options?: string[]
}

type ChatSession = {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  lastMessage?: string
}

export default function AiChatPage() {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([
    {
      id: "chat-1",
      title: "New Chat",
      messages: [
        {
          id: 1,
          role: "ai",
          content: "Welcome! Let's start by choosing your message format:",
          type: "options",
          options: ["Simple Message", "Email Format"]
        }
      ],
      createdAt: new Date(),
      lastMessage: "Welcome! Let's start by choosing your message format:"
    }
  ])
  const [currentChatId, setCurrentChatId] = useState<string>("chat-1")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [input, setInput] = useState("")
  const [selectedFormat, setSelectedFormat] = useState("")
  const [selectedAction, setSelectedAction] = useState("")
  const [showInput, setShowInput] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const currentChat = chatSessions.find(chat => chat.id === currentChatId)
  const messages = useMemo(() => currentChat?.messages || [], [currentChat?.messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const copyToClipboard = async (text: string, messageId: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMessageId(messageId)
      setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const updateCurrentChatMessages = (newMessages: Message[]) => {
    setChatSessions(prev => prev.map(chat =>
      chat.id === currentChatId
        ? {
          ...chat,
          messages: newMessages,
          lastMessage: newMessages[newMessages.length - 1]?.content || ""
        }
        : chat
    ))
  }

  const createNewChat = () => {
    const newChatId = `chat-${Date.now()}`
    const newChat: ChatSession = {
      id: newChatId,
      title: "New Chat",
      messages: [
        {
          id: 1,
          role: "ai",
          content: "Welcome! Let's start by choosing your message format:",
          type: "options",
          options: ["Simple Message", "Email Format"]
        }
      ],
      createdAt: new Date(),
      lastMessage: "Welcome! Let's start by choosing your message format:"
    }

    setChatSessions(prev => [...prev, newChat])
    setCurrentChatId(newChatId)
    setSelectedFormat("")
    setSelectedAction("")
    setShowInput(false)
    setCopiedMessageId(null)
  }

  const switchToChat = (chatId: string) => {
    setCurrentChatId(chatId)
    const chat = chatSessions.find(c => c.id === chatId)
    if (chat) {
      // Reset UI state based on current chat
      const hasSelectedFormat = chat.messages.some(m => m.role === "user" && ["Simple Message", "Email Format"].includes(m.content))
      const hasSelectedAction = chat.messages.some(m => m.role === "user" && ["Generate", "Follow Up"].includes(m.content))

      setSelectedFormat(hasSelectedFormat ? chat.messages.find(m => m.role === "user" && ["Simple Message", "Email Format"].includes(m.content))?.content || "" : "")
      setSelectedAction(hasSelectedAction ? chat.messages.find(m => m.role === "user" && ["Generate", "Follow Up"].includes(m.content))?.content || "" : "")
      setShowInput(hasSelectedFormat && hasSelectedAction)
    }
    setSidebarOpen(false)
  }

  const restartChat = () => {
    const initialMessages: Message[] = [
      {
        id: 1,
        role: "ai" as const,
        content: "Welcome! Let's start by choosing your message format:",
        type: "options",
        options: ["Simple Message", "Email Format"]
      }
    ]
    updateCurrentChatMessages(initialMessages)
    setSelectedFormat("")
    setSelectedAction("")
    setShowInput(false)
    setCopiedMessageId(null)
  }

  const handleOptionSelect = (messageId: number, option: string) => {
    // Find the message that triggered this selection
    const triggerMessage = messages.find(msg => msg.id === messageId)

    // Add user response first
    const newMessages: Message[] = [
      ...messages,
      { id: Date.now(), role: "user" as const, content: option, type: "text" }
    ]
    updateCurrentChatMessages(newMessages)

    // Check if this is the first question (message format)
    if (triggerMessage?.content.includes("message format")) {
      setSelectedFormat(option)
      // Add second AI message after user selects first option
      setTimeout(() => {
        const updatedMessages: Message[] = [
          ...newMessages,
          {
            id: Date.now() + 1,
            role: "ai" as const,
            content: "Great! Now choose what you'd like to do:",
            type: "options",
            options: ["Generate", "Follow Up"]
          }
        ]
        updateCurrentChatMessages(updatedMessages)
      }, 500)
    }
    // Check if this is the second question (action)
    else if (triggerMessage?.content.includes("what you'd like to do")) {
      setSelectedAction(option)
      setShowInput(true)
    }
  }

  const handleSend = () => {
    if (!input.trim()) return

    const newMessage: Message = {
      id: Date.now(),
      role: "user" as const,
      content: input,
      type: "text"
    }

    const updatedMessages: Message[] = [
      ...messages,
      newMessage,
      {
        id: Date.now() + 1,
        role: "ai" as const,
        content: "Processing your request... AI response coming soon!",
        type: "text"
      }
    ]
    updateCurrentChatMessages(updatedMessages)
    setInput("")
  }

  return (
    <div className="w-full flex flex-row mt-16 h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} w-80 h-full bg-card border-r flex flex-col flex-shrink-0 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static`}>
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between p-4 py-[27px] border-b bg-card">
            <h2 className="text-2xl font-semibold">Chats</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={createNewChat}
                className="flex items-center gap-2"
                title="New Chat"
              >
                <Plus className="h-4 w-4" />
                New
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto p-2 scrollbar-sleek">
            {chatSessions.map((chat) => (
              <div
                key={chat.id}
                onClick={() => switchToChat(chat.id)}
                className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors hover:bg-muted/60 ${currentChatId === chat.id ? 'bg-muted border border-border' : ''
                  }`}
              >
                <div className="flex items-start gap-3">
                  <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{chat.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {chat.lastMessage}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {chat.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex-1 h-full flex flex-col overflow-hidden">
        <Card className="h-full w-full flex flex-col border-0 shadow-none rounded-none">
          <CardHeader className="border-b bg-card">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <CardTitle className="text-xl lg:text-2xl font-semibold">
                  AI Chat Assistant
                </CardTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={restartChat}
                className="flex items-center gap-2 hover:bg-muted transition-colors"
                title="Restart conversation"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="hidden sm:inline">Restart</span>
              </Button>
            </div>
          </CardHeader>

        <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden p-0">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar-sleek">
              <div className="min-h-full flex flex-col justify-end space-y-6">
                {messages.map((msg) => (
                  <div key={msg.id} className="space-y-3">
                    {/* AI Message */}
                    {msg.role === "ai" && (
                      <div className="flex justify-start">
                        <div className="max-w-[80%] bg-muted/60 rounded-2xl p-4 shadow-sm border relative group">
                          <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              AI Assistant
                            </p>
                            <button
                              onClick={() => copyToClipboard(msg.content, msg.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
                              title="Copy message"
                            >
                              {copiedMessageId === msg.id ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                          <p className="text-base">{msg.content}</p>

                          {/* Option Buttons */}
                          {msg.type === "options" && msg.options && (
                            <div className="mt-4 space-y-2">
                              {msg.options.map((option) => (
                                <Button
                                  key={option}
                                  variant="outline"
                                  size="sm"
                                  className="mr-2 mb-2 hover:bg-primary hover:text-primary-foreground transition-colors"
                                  onClick={() => handleOptionSelect(msg.id, option)}
                                  disabled={
                                    (msg.content.includes("message format") && selectedFormat !== "") ||
                                    (msg.content.includes("what you'd like to do") && selectedAction !== "")
                                  }
                                >
                                  {option}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* User Message */}
                    {msg.role === "user" && (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl p-4 shadow-sm relative group">
                          <div className="flex justify-between items-start mb-1">
                            <p className="text-sm font-medium opacity-90">You</p>
                            <button
                              onClick={() => copyToClipboard(msg.content, msg.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-primary-foreground/20 rounded"
                              title="Copy message"
                            >
                              {copiedMessageId === msg.id ? (
                                <Check className="h-4 w-4 text-green-300" />
                              ) : (
                                <Copy className="h-4 w-4 text-primary-foreground/70" />
                              )}
                            </button>
                          </div>
                          <p className="text-base">{msg.content}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

          {/* Input Section */}
          {showInput && (
            <div className="border-t bg-card p-6 flex-shrink-0">
                <div className="space-y-4">
                  {/* Display selected options */}
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>Format: <strong>{selectedFormat}</strong></span>
                    <span>Action: <strong>{selectedAction}</strong></span>
                  </div>

                  {/* Input area */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        placeholder="Type your message here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        className="h-12 text-base"
                      />
                    </div>
                    <Button
                      onClick={handleSend}
                      className="h-12 px-6 font-medium"
                      disabled={!input.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
