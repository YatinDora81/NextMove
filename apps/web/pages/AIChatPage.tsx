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
import { useAI } from "@/hooks/useAI"
import { MessageType, RoomWithAIChatType } from "@/utils/api_types"


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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [input, setInput] = useState<string>("")
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())

  const { rooms, setCurrSelectedRoom, isNewRoom, setIsNewRoom, setNewRoomDetails, isAIChatLoading, newRoomDetails, currSelectedRoom, isNewRoomFocused, setIsNewRoomFocused } = useAI()


  const handleSelectRoom = (room: RoomWithAIChatType) => {
    setCurrSelectedRoom(room)
    setIsNewRoomFocused(false)
    // if(!newRoomDetails){
    //   setIsNewRoom(false)
    //   setNewRoomDetails(null)
    // }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedMessageId(id)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }

  const toggleMessageExpand = (messageId: string) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  const renderMessage = (message: string, messageId: string, isUserMessage: boolean = false) => {
    const isExpanded = expandedMessages.has(messageId)
    const shouldTruncate = message.length > 250

    if (!shouldTruncate) {
      return <p className="text-base whitespace-pre-wrap">{message}</p>
    }

    const truncatedMessage = message.slice(0, 250) + "..."

    return (
      <div>
        <p className="text-base whitespace-pre-wrap">{isExpanded ? message : truncatedMessage}</p>
        <button
          onClick={() => toggleMessageExpand(messageId)}
          className={`mt-2 text-sm transition-colors ${isUserMessage
            ? "text-primary-foreground/80 hover:text-primary-foreground underline"
            : "text-muted-foreground hover:text-foreground"
            }`}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-row mt-16 h-[calc(100vh-4rem)] bg-background">
      {/* Toast Notifications */}
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
                // onClick={createNewChat}
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

            {
              ((isNewRoom && !newRoomDetails) || (rooms.length === 0 && isAIChatLoading))
              &&
              <div
                onClick={() => {
                  setIsNewRoomFocused(true)
                  setIsNewRoom(true)
                  setCurrSelectedRoom(null)
                }}
                className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors hover:bg-muted/60 ${currSelectedRoom === null || isNewRoomFocused ? 'bg-muted border border-border' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">New Chat</h3>

                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
                      Welcome! Let's start by choosing your message format:
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {new Date().toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            }

            {rooms.map((room) => (
              <div
                key={room.id}
                onClick={() => {
                  handleSelectRoom(room)
                }}
                className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors hover:bg-muted/60 ${currSelectedRoom?.id === room.id ? 'bg-muted border border-border' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{room.name}</h3>
                    {room.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
                        {room.description}
                      </p>
                    )}
                    {/* {room.roomId && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-mono">
                        Room ID: {room.roomId}
                      </p>
                    )} */}
                    {/* <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {room.lastMessage}
                    </p> */}
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {(new Date(room.createdAt).toLocaleDateString() == new Date().toLocaleDateString() ? `Today ${new Date(room.createdAt).toLocaleTimeString()}` : new Date(room.createdAt).toLocaleDateString())}
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
                // onClick={resetCurrentChat}
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

                {/* PreDefined Messages of Old Rooms*/}
                {currSelectedRoom?.predefinedMessages && currSelectedRoom?.predefinedMessages.length > 0 && (
                  <div className="flex flex-col w-full gap-5 justify-start">
                    {/* 1 Message by ai */}
                    <div className="max-w-fit bg-muted/60 rounded-2xl p-4 shadow-sm border relative group">
                      <div className="flex justify-between flex-col gap-3 items-start mb-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          AI Assistant
                        </p>
                        <p>
                          Welcome! Let's start by choosing your message format:
                        </p>

                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2 mb-2 hover:bg-primary hover:text-primary-foreground 
                              transition-colors"
                            disabled
                          >
                            Simple Message
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2 mb-2 hover:bg-primary hover:text-primary-foreground transition-colors"
                            disabled
                          >
                            Email Format
                          </Button>
                        </div>

                      </div>
                    </div>

                    {/* 2 Message by me */}
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl p-4 shadow-sm relative group">
                        <p className="text-sm font-medium opacity-90">You</p>
                        <p className="text-base capitalize">{currSelectedRoom?.predefinedMessages[0]}</p>
                      </div>
                    </div>

                    {/* 3 Message by ai */}
                    <div className="max-w-fit bg-muted/60 rounded-2xl p-4 shadow-sm border relative group">
                      <div className="flex justify-between flex-col gap-3 items-start mb-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          AI Assistant
                        </p>
                        <p>
                          Great! Now choose what you'd like to do:
                        </p>

                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2 mb-2 hover:bg-primary hover:text-primary-foreground 
                              transition-colors"
                            disabled
                          >
                            Generate
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2 mb-2 hover:bg-primary hover:text-primary-foreground transition-colors"
                            disabled
                          >
                            Follow Up
                          </Button>
                        </div>

                      </div>
                    </div>

                    {/* 4 Message by me */}
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl p-4 shadow-sm relative group">
                        <p className="text-sm font-medium opacity-90">You</p>
                        <p className="text-base capitalize">{currSelectedRoom?.predefinedMessages[1]}</p>
                      </div>
                    </div>
                  </div>
                )}

                {currSelectedRoom?.messages.map((msg: MessageType) => (
                  <div key={msg.id} className="space-y-3">

                    {/* AI Message */}
                    {msg.by === "AI" && (
                      <div className="flex justify-start">
                        <div className="max-w-[80%] bg-muted/60 rounded-2xl p-4 shadow-sm border relative group">
                          <div className="flex justify-between items-start mb-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              AI Assistant
                            </p>
                            <button
                              onClick={() => copyToClipboard(msg.message, msg.id)}
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
                          {renderMessage(msg.message, msg.id, false)}

                          {/* Option Buttons */}

                        </div>
                      </div>
                    )}

                    {/* User Message */}
                    {msg.by !== "AI" && (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl p-4 shadow-sm relative group">
                          <div className="flex justify-between items-start mb-1">
                            <p className="text-sm font-medium opacity-90">You</p>
                            <button
                              onClick={() => copyToClipboard(msg.message, msg.id)}
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
                          {renderMessage(msg.message, msg.id, true)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {/* Typing indicator
                // {isLoading && (
                //   <div className="space-y-3">
                //     <TypingIndicator />
                //   </div>
                // )} */}
                {/* <div ref={messagesEndRef} /> */}
              </div>
            </div>

            {/* Input Section */}
            {/* 1 more condition here to check two predefined message are there */}
            {(!isNewRoom || (isNewRoom && newRoomDetails !== null)) && (
              <div className="border-t bg-card p-6 flex-shrink-0">
                <div className="space-y-4">
                  {/* Display selected options */}
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    {/* <span>Format: <strong>{userChoices.messageFormat}</strong></span>
                    <span>Action: <strong>{userChoices.action}</strong></span> */}
                  </div>

                  {/* Input area */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        placeholder="Type your message here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        // onKeyDown={(e) => e.key === "Enter" && handleSendAttempt()}
                        className="h-12 text-base"
                      />
                    </div>
                    <Button
                      // onClick={handleSendAttempt}
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


