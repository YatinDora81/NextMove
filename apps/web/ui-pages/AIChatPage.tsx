"use client"

import type { ReactNode } from "react"
import { useState, useEffect, useRef } from "react"
import { Check, Copy, Menu, MessageSquare, Plus, RotateCcw, Send, X } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { Card } from "@/components/quiet/Card"
import { Input } from "@/components/quiet/Field"
import { cx } from "@/components/quiet/cx"
import { useAI } from "@/hooks/useAI"
import { MessageType, RoomWithAIChatType } from "@/utils/api_types"
import toast from "react-hot-toast"

const conversationLabel = (value: Date | string) => {
    const created = new Date(value)
    return created.toLocaleDateString() === new Date().toLocaleDateString()
        ? "Today " + created.toLocaleTimeString()
        : created.toLocaleDateString()
}

const Divider = ({ children }: { children: ReactNode }) => (
    <div className="flex items-center gap-3 text-[11px] font-medium tracking-[0.06em] text-fg3">
        <span className="h-px flex-1 bg-hair" />
        {children}
        <span className="h-px flex-1 bg-hair" />
    </div>
)

const TypingIndicator = () => (
    <Card className="mt-3 self-start px-3.5 py-3.5">
        <span className="sr-only">Assistant is typing</span>
        <div aria-hidden className="flex items-center gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-fg3" />
            <span className="size-1.5 animate-pulse rounded-full bg-fg3 [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-fg3 [animation-delay:300ms]" />
        </div>
    </Card>
)

export default function AiChatPage() {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
    const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const composerRef = useRef<HTMLInputElement>(null)

    const { rooms, setCurrSelectedRoom, isNewRoom, setIsNewRoom, setNewRoomDetails, isAIChatLoading, newRoomDetails, currSelectedRoom, isNewRoomFocused, setIsNewRoomFocused, addNewMessage, input, setInput, messageResponseLoading, setMessageResponseLoading } = useAI()

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [currSelectedRoom?.messages, newRoomDetails, messageResponseLoading])

    const handleSelectRoom = (room: RoomWithAIChatType) => {
        setCurrSelectedRoom(room)
        setIsNewRoomFocused(false)
    }

    const startNewChat = () => {
        setIsNewRoomFocused(true)
        setIsNewRoom(true)
        setCurrSelectedRoom(null)
        setNewRoomDetails(null)
        setInput("")
        setMessageResponseLoading(false)
    }

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopiedMessageId(id)
        setTimeout(() => setCopiedMessageId(null), 2000)
    }

    const prefillComposer = (text: string) => {
        setInput(text)
        composerRef.current?.focus()
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
            return <p className="whitespace-pre-wrap">{message}</p>
        }

        const truncatedMessage = message.slice(0, 250) + "..."

        return (
            <div>
                <p className="whitespace-pre-wrap">{isExpanded ? message : truncatedMessage}</p>
                <button
                    onClick={() => toggleMessageExpand(messageId)}
                    className={cx(
                        "mt-2 text-[12.5px] font-medium underline underline-offset-2 transition-colors",
                        isUserMessage ? "text-on-acc/75 hover:text-on-acc" : "text-fg2 hover:text-fg"
                    )}
                >
                    {isExpanded ? "Show less" : "Show more"}
                </button>
            </div>
        )
    }

    const handleMessageSent = () => {
        if (isNewRoom && newRoomDetails && newRoomDetails.length > 0) {
            addNewMessage(input, null, true, newRoomDetails, [])
        }
        else if (currSelectedRoom && currSelectedRoom.predefinedMessages && currSelectedRoom.predefinedMessages.length > 0) addNewMessage(input, currSelectedRoom?.id, false, currSelectedRoom?.predefinedMessages, currSelectedRoom?.messages.map((msg: MessageType) => msg.message))
        else {
            toast.error("Please select a room or create a new room")
        }
    }

    const railItem = "flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left text-[13.5px] font-medium transition-colors"
    const railOn = "bg-surface text-fg shadow-qsm"
    const railOff = "text-fg2 hover:bg-well2 hover:text-fg"
    const newChatActive = currSelectedRoom === null || isNewRoomFocused

    return (
        <div className="flex h-[calc(100dvh-61px)] w-full flex-row bg-bg">
            <aside
                className={cx(
                    "fixed z-30 flex h-[calc(100dvh-61px)] w-[216px] flex-none flex-col bg-well px-2.5 py-3.5 transition-transform duration-150 ease-out lg:relative lg:translate-x-0",
                    sidebarOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="mb-2.5 flex items-center gap-2">
                    <Button
                        variant="sec"
                        onClick={startNewChat}
                        title="New chat"
                        className="flex-1 justify-center gap-1.5 py-2 text-[13px]"
                    >
                        <Plus className="size-3.5" strokeWidth={1.5} />
                        New chat
                    </Button>
                    <Button
                        variant="ghost"
                        aria-label="Close chats"
                        onClick={() => setSidebarOpen(false)}
                        className="px-2 py-2 lg:hidden"
                    >
                        <X className="size-4" strokeWidth={1.5} />
                    </Button>
                </div>

                <div className="px-3 pt-0.5 pb-2 text-[11px] font-medium tracking-[0.08em] text-fg3 uppercase">
                    Recent
                </div>

                <div className="scrollbar-sleek flex flex-1 flex-col gap-0.5 overflow-y-auto">
                    {((isNewRoom) || (rooms.length === 0 && isAIChatLoading)) && (
                        <button
                            onClick={() => {
                                setIsNewRoomFocused(true)
                                setIsNewRoom(true)
                                setCurrSelectedRoom(null)
                            }}
                            className={cx(railItem, newChatActive ? railOn : railOff)}
                        >
                            <MessageSquare
                                className={cx("size-4 flex-none", newChatActive && "text-acc")}
                                strokeWidth={1.5}
                            />
                            <span className="min-w-0 flex-1 truncate">New chat</span>
                        </button>
                    )}

                    {rooms.map((room) => {
                        const on = currSelectedRoom?.id === room.id
                        return (
                            <button
                                key={room.id}
                                onClick={() => handleSelectRoom(room)}
                                title={room.name}
                                className={cx(railItem, "items-start", on ? railOn : railOff)}
                            >
                                <MessageSquare
                                    className={cx("mt-0.5 size-4 flex-none", on && "text-acc")}
                                    strokeWidth={1.5}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{room.name}</span>
                                    {room.description && (
                                        <span className="mt-0.5 block truncate text-xs font-normal text-fg3">
                                            {room.description}
                                        </span>
                                    )}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </aside>

            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-20 bg-fg/30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex flex-none items-center justify-between gap-3 border-b border-hair bg-surface px-6 py-3">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            aria-label="Open chats"
                            onClick={() => setSidebarOpen(true)}
                            className="px-2 py-2 lg:hidden"
                        >
                            <Menu className="size-4" strokeWidth={1.5} />
                        </Button>
                        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
                            AI Chat Assistant
                        </h1>
                    </div>

                    {!currSelectedRoom ? (
                        <Button
                            variant="sec"
                            onClick={startNewChat}
                            title="Restart conversation"
                            className="gap-1.5 px-3 py-1.5 text-[12.5px]"
                        >
                            <RotateCcw className="size-3.5" strokeWidth={1.5} />
                            <span className="max-sm:hidden">Restart</span>
                        </Button>
                    ) : (
                        <div className="min-w-0 text-right">
                            <div className="truncate text-[13px] font-medium text-fg">
                                {currSelectedRoom?.name}
                            </div>
                            <div className="tnum text-xs text-fg2">
                                {new Date(currSelectedRoom?.createdAt || new Date()).toLocaleDateString()}
                            </div>
                        </div>
                    )}
                </div>

                <div className="scrollbar-sleek flex-1 overflow-y-auto px-6 py-5">
                    <div className="flex min-h-full flex-col justify-start lg:justify-end">
                        <Divider>
                            {currSelectedRoom ? conversationLabel(currSelectedRoom.createdAt) : "New chat"}
                        </Divider>

                        {currSelectedRoom?.predefinedMessages && currSelectedRoom?.predefinedMessages.length > 0 && (
                            <>
                                <Card className="mt-3 max-w-[76%] self-start px-3.5 py-3 text-[13.5px] leading-[1.65] text-fg">
                                    <span className="sr-only">Assistant</span>
                                    <p>Welcome! Let&apos;s start by choosing your message format:</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" disabled>
                                            Simple Message
                                        </Button>
                                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" disabled>
                                            Email Format
                                        </Button>
                                    </div>
                                </Card>

                                <div className="mt-3.5 max-w-[70%] self-end rounded-[12px_12px_3px_12px] bg-acc px-[13px] py-[9px] text-[13.5px] leading-[1.65] text-on-acc">
                                    <span className="sr-only">You</span>
                                    <p className="capitalize">{currSelectedRoom?.predefinedMessages[0]}</p>
                                </div>

                                <Card className="mt-3 max-w-[76%] self-start px-3.5 py-3 text-[13.5px] leading-[1.65] text-fg">
                                    <span className="sr-only">Assistant</span>
                                    <p>Great! Now choose what you&apos;d like to do:</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" disabled>
                                            Generate
                                        </Button>
                                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" disabled>
                                            Follow Up
                                        </Button>
                                    </div>
                                </Card>

                                <div className="mt-3.5 max-w-[70%] self-end rounded-[12px_12px_3px_12px] bg-acc px-[13px] py-[9px] text-[13.5px] leading-[1.65] text-on-acc">
                                    <span className="sr-only">You</span>
                                    <p className="capitalize">{currSelectedRoom?.predefinedMessages[1]}</p>
                                </div>
                            </>
                        )}

                        {isNewRoom && (
                            <>
                                <Card className="mt-3 max-w-[76%] self-start px-3.5 py-3 text-[13.5px] leading-[1.65] text-fg">
                                    <span className="sr-only">Assistant</span>
                                    <p>Welcome! Let&apos;s start by choosing your message format:</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button
                                            variant="sec"
                                            className="px-3 py-1.5 text-[12.5px]"
                                            onClick={() => {
                                                setNewRoomDetails([...(newRoomDetails || []), "Simple message"])
                                            }}
                                            disabled={(newRoomDetails?.length || 0) > 0}
                                        >
                                            Simple Message
                                        </Button>
                                        <Button
                                            variant="sec"
                                            className="px-3 py-1.5 text-[12.5px]"
                                            disabled={(newRoomDetails?.length || 0) > 0}
                                            onClick={() => {
                                                setNewRoomDetails([...(newRoomDetails || []), "Email Format"])
                                            }}
                                        >
                                            Email Format
                                        </Button>
                                    </div>
                                </Card>

                                {newRoomDetails && newRoomDetails.length >= 1 && (
                                    <div className="mt-3.5 max-w-[70%] self-end rounded-[12px_12px_3px_12px] bg-acc px-[13px] py-[9px] text-[13.5px] leading-[1.65] text-on-acc">
                                        <span className="sr-only">You</span>
                                        <p className="capitalize">{newRoomDetails?.[0]}</p>
                                    </div>
                                )}

                                {newRoomDetails && newRoomDetails.length >= 1 && (
                                    <Card className="mt-3 max-w-[76%] self-start px-3.5 py-3 text-[13.5px] leading-[1.65] text-fg">
                                        <span className="sr-only">Assistant</span>
                                        <p>Great! Now choose what you&apos;d like to do:</p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <Button
                                                variant="sec"
                                                className="px-3 py-1.5 text-[12.5px]"
                                                onClick={() => {
                                                    setNewRoomDetails([...(newRoomDetails || []), "Generate"])
                                                }}
                                                disabled={(newRoomDetails?.length || 0) > 1}
                                            >
                                                Generate
                                            </Button>
                                            <Button
                                                variant="sec"
                                                className="px-3 py-1.5 text-[12.5px]"
                                                onClick={() => {
                                                    setNewRoomDetails([...(newRoomDetails || []), "Follow Up"])
                                                }}
                                                disabled={(newRoomDetails?.length || 0) > 1}
                                            >
                                                Follow Up
                                            </Button>
                                        </div>
                                    </Card>
                                )}

                                {newRoomDetails && newRoomDetails.length >= 2 && (
                                    <div className="mt-3.5 max-w-[70%] self-end rounded-[12px_12px_3px_12px] bg-acc px-[13px] py-[9px] text-[13.5px] leading-[1.65] text-on-acc">
                                        <span className="sr-only">You</span>
                                        <p className="capitalize">{newRoomDetails?.[1]}</p>
                                    </div>
                                )}
                            </>
                        )}

                        {currSelectedRoom?.messages.map((msg: MessageType) => (
                            msg.by === "AI" ? (
                                <Card key={msg.id} className="mt-3 max-w-[76%] self-start">
                                    <div className="px-3.5 py-[11px] text-[13.5px] leading-[1.65] text-fg">
                                        <span className="sr-only">Assistant</span>
                                        {renderMessage(msg.message, msg.id, false)}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 border-t border-hair px-2.5 py-2">
                                        <Button
                                            variant="ghost"
                                            onClick={() => copyToClipboard(msg.message, msg.id)}
                                            title="Copy message"
                                            className="gap-1.5 px-2.5 py-1 text-xs"
                                        >
                                            {copiedMessageId === msg.id ? (
                                                <Check className="size-3 text-ok" strokeWidth={1.5} />
                                            ) : (
                                                <Copy className="size-3" strokeWidth={1.5} />
                                            )}
                                            Copy
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => prefillComposer("Shorten the previous message.")}
                                            disabled={messageResponseLoading}
                                            className="px-2.5 py-1 text-xs"
                                        >
                                            Shorten
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => prefillComposer("Rewrite the previous message in a more formal tone.")}
                                            disabled={messageResponseLoading}
                                            className="px-2.5 py-1 text-xs"
                                        >
                                            More formal
                                        </Button>
                                    </div>
                                </Card>
                            ) : (
                                <div
                                    key={msg.id}
                                    className="group mt-3.5 flex max-w-[70%] items-start gap-2 self-end rounded-[12px_12px_3px_12px] bg-acc px-[13px] py-[9px] text-[13.5px] leading-[1.65] text-on-acc"
                                >
                                    <div className="min-w-0 flex-1">
                                        <span className="sr-only">You</span>
                                        {renderMessage(msg.message, msg.id, true)}
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(msg.message, msg.id)}
                                        title="Copy message"
                                        aria-label="Copy message"
                                        className="mt-0.5 flex-none text-on-acc/70 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                    >
                                        {copiedMessageId === msg.id ? (
                                            <Check className="size-3.5" strokeWidth={1.5} />
                                        ) : (
                                            <Copy className="size-3.5" strokeWidth={1.5} />
                                        )}
                                    </button>
                                </div>
                            )
                        ))}

                        {messageResponseLoading && <TypingIndicator />}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {(currSelectedRoom || (isNewRoom && newRoomDetails && newRoomDetails.length >= 2)) && (
                    <div className="flex flex-none items-center gap-2.5 border-t border-hair bg-surface px-6 py-4">
                        <Input
                            ref={composerRef}
                            placeholder="Message… (↵ to send)"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !messageResponseLoading && handleMessageSent()}
                            className="flex-1"
                            disabled={messageResponseLoading}
                        />
                        <Button
                            variant="acc"
                            onClick={handleMessageSent}
                            aria-label={messageResponseLoading ? "Sending message" : "Send message"}
                            title={messageResponseLoading ? "Sending…" : "Send"}
                            className="h-[38px] flex-none px-3.5"
                            disabled={!input.trim() || messageResponseLoading}
                        >
                            <Send className="size-4" strokeWidth={1.5} />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
