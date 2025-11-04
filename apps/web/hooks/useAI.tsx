"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RoomWithAIChatType } from "@/utils/api_types";
import { ADD_NEW_MESSAGE, GET_ALL_ROOMS } from "@/utils/url";
import { useAuth } from "@clerk/nextjs";
import { createContext, useContext, useEffect, useState } from "react"
import toast from "react-hot-toast";

type AIContextType = {
    rooms: RoomWithAIChatType[] | any[],
    setRooms: (rooms: RoomWithAIChatType[] | any[]) => void,
    isAIChatLoading: boolean,
    setIsAIChatLoading: (isAIChatLoading: boolean) => void,
    currSelectedRoom: RoomWithAIChatType | null,
    setCurrSelectedRoom: (currSelectedRoom: RoomWithAIChatType | null) => void,
    isNewRoom: boolean,
    setIsNewRoom: (isNewRoom: boolean) => void,
    newRoomDetails: string[] | null,
    setNewRoomDetails: (newRoomDetails: string[] | null) => void,
    isNewRoomFocused: boolean,
    setIsNewRoomFocused: (isNewRoomFocused: boolean) => void,
    addNewMessage: (message: string, roomId: string | null, roomNew: boolean, roomPredefinedMessages: string[] | null, roomAllMessages: string[]) => Promise<void>,
    fetchRooms: () => Promise<void>,
    messageResponseLoading: boolean,
    setMessageResponseLoading: (messageResponseLoading: boolean) => void,
    input: string,
    setInput: (input: string) => void,
}

const AIContext = createContext<AIContextType | null>(null);

export const AIProvider = ({ children }: { children: React.ReactNode }) => {

    const { getToken } = useAuth()
    const [rooms, setRooms] = useState<RoomWithAIChatType[] | any[]>([]);
    const [isAIChatLoading, setIsAIChatLoading] = useState(false);
    const [currSelectedRoom, setCurrSelectedRoom] = useState<RoomWithAIChatType | null>(null);
    const [isNewRoom, setIsNewRoom] = useState(false);
    const [isNewRoomFocused, setIsNewRoomFocused] = useState(false);
    const [newRoomDetails, setNewRoomDetails] = useState<any | null>(null);
    const [messageResponseLoading, setMessageResponseLoading] = useState(false);
    const [input, setInput] = useState<string>("")

    const addNewMessage = async (message: string, roomId: string | null, roomNew: boolean = false, roomPredefinedMessages: string[] | null = null, roomAllMessages: string[] = []) => {
        try {
            setMessageResponseLoading(true);
            const token = await getToken({ template: "frontend_token" })
            if (!token) {
                throw new Error("Token not found")
            }
            let dataa;
            if (roomNew) {
                dataa = {
                    "isNewRoom": true,
                    "predefinedMessages": newRoomDetails,
                    "roomId": roomId,
                    "message": message,
                    "roomAllMessages": roomAllMessages
                }
            }
            else {
                dataa = {
                    "isNewRoom": false,
                    "predefinedMessages": roomPredefinedMessages,
                    "roomId": roomId,
                    "message": message,
                    "roomAllMessages": roomAllMessages
                }
            }
            const res = await fetch(ADD_NEW_MESSAGE, {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(dataa),
                method: "POST"
            })
            const data = await res.json()
            if (!data.success) {
                toast.error(data.message || "Something went wrong")
                return
            }
            else {
                if (!roomNew) {

                    setInput("")
                    setRooms(prev => prev.map((room: RoomWithAIChatType) => {
                        if (room.id === roomId) {
                            return {
                                ...room,
                                messages: [...room.messages, {
                                    id: data.data.id,
                                    message: data.data.message,
                                }]
                            }
                        }
                        return room;
                    }))

                    if (currSelectedRoom && currSelectedRoom.id === roomId) {
                        setCurrSelectedRoom({
                            ...currSelectedRoom,
                            messages: [...currSelectedRoom.messages, ...data.data]
                        })
                    }

                }
                else {
                    setRooms(() => {
                        return [...rooms, {
                            id: data.data[0].roomId,
                            name: data.data[0].room.name,
                            description: data.data[0].room.description,
                            predefinedMessages: data.data[0].room.predefinedMessages,
                            userId: data.data[0].room.userId,
                            createdAt: data.data[0].room.createdAt,
                            updatedAt: data.data[0].room.updatedAt,
                            messages: [...data.data]
                        } as RoomWithAIChatType]
                    })

                    setIsNewRoom(false)
                    setNewRoomDetails(null)
                    setCurrSelectedRoom({
                        id: data.data[0].roomId,
                        name: data.data[0].room.name,
                        description: data.data[0].room.description,
                        predefinedMessages: data.data[0].room.predefinedMessages,
                        userId: data.data[0].room.userId,
                        createdAt: data.data[0].room.createdAt,
                        updatedAt: data.data[0].room.updatedAt,
                        messages: [...data.data]
                    } as RoomWithAIChatType)
                    setIsNewRoomFocused(false)
                    setInput("")
                    setMessageResponseLoading(false)
                }
                toast.success(data.message || "Message added successfully")
            }
        }
        catch (error) {
            toast.error((error as Error).message || "Something went wrong")
        }
        finally {
            setMessageResponseLoading(false);
        }
    }


    const fetchRooms = async () => {
        setIsAIChatLoading(true);
        try {
            const token = await getToken({ template: "frontend_token" })
            if (!token) {
                throw new Error("Token not found")
            }
            const res = await fetch(GET_ALL_ROOMS, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            })
            const data = await res.json()
            if (!data.success) {
                toast.error(data.message || "Something went wrong")
                return
            }
            else setRooms(data.data)
        } catch (error) {
            toast.error((error as Error).message || "Something went wrong")
            return
        } finally {
            setIsAIChatLoading(false)
        }
    }


    useEffect(() => {
        fetchRooms()
        if (sessionStorage.getItem("is-pre-selected-room")) {
            const preSelectedRoom = JSON.parse(sessionStorage.getItem("is-pre-selected-room")!)
            if (rooms.find((room: RoomWithAIChatType) => room.id === preSelectedRoom.id)) {
                setIsNewRoom(false)
                setNewRoomDetails(null)
                setCurrSelectedRoom(rooms.find((room: RoomWithAIChatType) => room.id === preSelectedRoom.id)!)
            }
            else {
                setIsNewRoom(true)
                setIsNewRoomFocused(true)
                setNewRoomDetails(null)
            }
        }
        else {
            setIsNewRoom(true)
            setIsNewRoomFocused(true)
            setNewRoomDetails(null)
        }
    }, [])

    useEffect(() => {
        if (currSelectedRoom) {
            sessionStorage.setItem("is-pre-selected-room", JSON.stringify(currSelectedRoom))
            setNewRoomDetails(null);

        }
        else {
            sessionStorage.removeItem("is-pre-selected-room")
            setIsNewRoom(true);
            setNewRoomDetails(null);
        }
    }, [currSelectedRoom])



    console.log("Curr Selected Room", currSelectedRoom)

    return (
        <AIContext.Provider value={{ rooms, setRooms, isAIChatLoading, setIsAIChatLoading, fetchRooms, currSelectedRoom, setCurrSelectedRoom, isNewRoom, setIsNewRoom, newRoomDetails, setNewRoomDetails, isNewRoomFocused, setIsNewRoomFocused, addNewMessage, messageResponseLoading, setMessageResponseLoading, input, setInput }}>
            {children}
        </AIContext.Provider >
    )
}

export const useAI = () => {
    const context = useContext(AIContext);
    if (!context) {
        throw new Error("useAI must be used within a AIProvider");
    }
    return context;
}