"use client"
import React, { useState, useEffect, useRef } from "react"
import { Copy, Check, RotateCcw, Plus, MessageSquare, Menu, X } from "lucide-react"
import { useToast, ToastContainer } from "@/lib/toast"
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

type ChatRoom = {
  id: string
  title: string
  description?: string
  roomId?: string
  createdAt: Date
  lastMessage?: string
}

type UserChoices = {
  messageFormat: string
  action: string
}


// All conversation flow messages in order
const CONVERSATION_MESSAGES: Message[] = [
  {
    id: 1,
    role: "ai",
    content: "Welcome! Let's start by choosing your message format:",
    type: "options",
    options: ["Simple Message", "Email Format"]
  },
  {
    id: 2,
    role: "ai",
    content: "Great! Now choose what you'd like to do:",
    type: "options",
    options: ["Generate", "Follow Up"]
  }
]


// Typing indicator component
const TypingIndicator = () => (
  <div className="flex justify-start">
    <div className="max-w-[80%] bg-muted/60 rounded-2xl p-4 shadow-sm border">
      <div className="flex justify-between items-start mb-2">
        <p className="text-sm font-medium text-muted-foreground">AI Assistant</p>
      </div>
      <div className="flex items-center space-x-1">
        <span className="text-base">AI is typing</span>
        <div className="flex space-x-1 ml-2">
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
        </div>
      </div>
    </div>
  </div>
)


export default function AiChatPage() {
  // Clean state management
  const [rooms, setRooms] = useState<ChatRoom[]>([{
    id: "chat-1",
    title: "New Chat", 
    createdAt: new Date(),
    lastMessage: CONVERSATION_MESSAGES[0]?.content || ""
  }])
  const [currentChat, setCurrentChat] = useState<Message[]>([CONVERSATION_MESSAGES[0]!])
  const [currentRoomId, setCurrentRoomId] = useState<string>("chat-1")
  const [currentMessageNum, setCurrentMessageNum] = useState<number>(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [input, setInput] = useState("")
  const [userChoices, setUserChoices] = useState<UserChoices>({ messageFormat: "", action: "" })
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Toast management
  const { toasts, showWaitToast, showSuccessToast, showErrorToast, showCreateRoomToast } = useToast()

  // Computed values
  const showInput = currentMessageNum >= CONVERSATION_MESSAGES.length

  // Helper functions
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const copyToClipboard = async (text: string, messageId: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMessageId(messageId)
      setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }


  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom()
  }, [currentChat])

  // Simple helper functions  
  const updateCurrentRoom = (updates: Partial<ChatRoom>) => {
    setRooms(prev => prev.map(room =>
      room.id === currentRoomId ? { ...room, ...updates } : room
    ))
  }

  const createNewChat = () => {
    const hasUserMessages = currentChat.some(msg => msg.role === "user")
    
    if (!hasUserMessages) {
      // Reset current chat
      setCurrentChat([CONVERSATION_MESSAGES[0]!])
      setCurrentMessageNum(0)
      setUserChoices({ messageFormat: "", action: "" })
      setCopiedMessageId(null)
      setIsLoading(false)
      updateCurrentRoom({ 
        title: "New Chat", 
        description: undefined,
        roomId: undefined,
        lastMessage: CONVERSATION_MESSAGES[0]?.content || ""
      })
    } else {
      // Create new room
      const newRoomId = `chat-${Date.now()}`
      const newRoom: ChatRoom = {
        id: newRoomId,
        title: "New Chat",
        createdAt: new Date(),
        lastMessage: CONVERSATION_MESSAGES[0]?.content || ""
      }

      setRooms(prev => [...prev, newRoom])
      setCurrentRoomId(newRoomId)
      setCurrentChat([CONVERSATION_MESSAGES[0]!])
      setCurrentMessageNum(0)
      setUserChoices({ messageFormat: "", action: "" })
      setCopiedMessageId(null)
      setIsLoading(false)
    }
    setSidebarOpen(false)
  }

  const resetCurrentChat = () => {
    setCurrentChat([CONVERSATION_MESSAGES[0]!])
    setCurrentMessageNum(0)
    setUserChoices({ messageFormat: "", action: "" })
    setCopiedMessageId(null)
    setIsLoading(false)
    updateCurrentRoom({ 
      title: "New Chat", 
      description: undefined,
      roomId: undefined,
      lastMessage: CONVERSATION_MESSAGES[0]?.content || ""
    })
  }

  // Message handling functions
  const handleOptionSelect = (messageId: number, option: string) => {
    // Add user response
    const userMessage: Message = {
      id: Date.now(),
      role: "user" as const,
      content: option,
      type: "text"
    }
    
    const newMessages: Message[] = [...currentChat, userMessage]
    setCurrentChat(newMessages)
    updateCurrentRoom({ lastMessage: option })

    // Store user choice
    if (currentMessageNum === 0) {
      setUserChoices(prev => ({ ...prev, messageFormat: option }))
    } else if (currentMessageNum === 1) {
      setUserChoices(prev => ({ ...prev, action: option }))
    }

    // Move to next message or enable input
    const nextMessageNum = currentMessageNum + 1
    setCurrentMessageNum(nextMessageNum)

    // Add next conversation message if available
    if (nextMessageNum < CONVERSATION_MESSAGES.length) {
      setTimeout(() => {
        const nextMessage: Message = { ...CONVERSATION_MESSAGES[nextMessageNum]!, id: Date.now() + 1 }
        setCurrentChat(prev => [...prev, nextMessage])
      }, 500)
    }
  }

  const handleSendAttempt = () => {
    if (isLoading) {
      showWaitToast()
      return
    }
    handleSend()
  }

  const handleSend = async () => {
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now(),
      role: "user" as const,
      content: input,
      type: "text"
    }

    const messagesWithUser: Message[] = [...currentChat, userMessage]
    setCurrentChat(messagesWithUser)
    const inputText = input
    setInput("")
    setIsLoading(true)

    try {
      const isFirstChatMessage = currentMessageNum === CONVERSATION_MESSAGES.length
      
      if (isFirstChatMessage) {
        showCreateRoomToast()
      }

      const delay = Math.random() * 2000 + 2000
      await new Promise(resolve => setTimeout(resolve, delay))

      let aiResponse: Message

      if (isFirstChatMessage) {
        const roomId = `room_${Date.now()}`
        
        aiResponse = {
          id: Date.now() + 1,
          role: "ai" as const,
          content: `Great! I've created a room for our conversation. ${generateResponse(inputText, userChoices)}`,
          type: "text"
        }

        updateCurrentRoom({
          title: `Chat about ${inputText.slice(0, 30)}${inputText.length > 30 ? '...' : ''}`,
          roomId,
          lastMessage: aiResponse.content
        })

        showSuccessToast(`Room created successfully!`)
      } else {
        aiResponse = {
          id: Date.now() + 1,
          role: "ai" as const,
          content: generateResponse(inputText, userChoices),
          type: "text"
        }

        updateCurrentRoom({ lastMessage: aiResponse.content })
      }

      setCurrentChat([...messagesWithUser, aiResponse])

    } catch (error) {
      console.error('Error sending message:', error)
      showErrorToast('Failed to send message. Please try again.')
      
      const errorMessage: Message = {
        id: Date.now() + 1,
        role: "ai" as const,
        content: "Sorry, I encountered an error. Please try again.",
        type: "text"
      }
      setCurrentChat([...messagesWithUser, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const generateResponse = (userInput: string, choices: UserChoices): string => {
    return `I received your message: "${userInput}". Here's my response based on your chosen format (${choices.messageFormat}) and action (${choices.action}). This is a simulated AI response that would normally come from your API.`
  }

  return (
    <div className="w-full flex flex-row mt-16 h-[calc(100vh-4rem)] bg-background">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} w-80 h-full bg-card border-r flex flex-col transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:flex-shrink-0 fixed lg:relative z-30`}>
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
          <div className="flex-1 w-full overflow-y-auto p-2 scrollbar-sleek">
            {rooms.map((room) => (
              <div
                key={room.id}
                onClick={() => setCurrentRoomId(room.id)}
                className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors hover:bg-muted/60 ${currentRoomId === room.id ? 'bg-muted border border-border' : ''
                  }`}
              >
                <div className="flex items-start gap-3">
                  <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{room.title}</h3>
                    {room.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
                        {room.description}
                      </p>
                    )}
                    {room.roomId && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-mono">
                        Room ID: {room.roomId}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {room.lastMessage}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {room.createdAt.toLocaleDateString()}
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
                onClick={resetCurrentChat}
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
              <div className="min-h-full flex flex-col justify-start lg:justify-end space-y-6">
                {currentChat.map((msg) => (
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
                                    (msg.content.includes("message format") && userChoices.messageFormat !== "") ||
                                    (msg.content.includes("what you'd like to do") && userChoices.action !== "")
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
                {/* Typing indicator */}
                {isLoading && (
                  <div className="space-y-3">
                    <TypingIndicator />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

          {/* Input Section */}
          {showInput && (
            <div className="border-t bg-card p-6 flex-shrink-0">
                <div className="space-y-4">
                  {/* Display selected options */}
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>Format: <strong>{userChoices.messageFormat}</strong></span>
                    <span>Action: <strong>{userChoices.action}</strong></span>
                  </div>

                  {/* Input area */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        placeholder="Type your message here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendAttempt()}
                        className="h-12 text-base"
                      />
                    </div>
                    <Button
                      onClick={handleSendAttempt}
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

