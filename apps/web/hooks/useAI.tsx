"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RoomWithAIChatType } from "@/utils/api_types";
import { GET_ALL_ROOMS } from "@/utils/url";
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
    newRoomDetails: any | null,
    setNewRoomDetails: (newRoomDetails: any | null) => void,
    isNewRoomFocused: boolean,
    setIsNewRoomFocused: (isNewRoomFocused: boolean) => void,
    fetchRooms: () => Promise<void>,
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
        }
        else {
            sessionStorage.removeItem("is-pre-selected-room")
        }
    }, [currSelectedRoom])


    // console.log("Curr Selected Room" , currSelectedRoom)

    return (
        <AIContext.Provider value={{ rooms, setRooms, isAIChatLoading, setIsAIChatLoading, fetchRooms, currSelectedRoom, setCurrSelectedRoom, isNewRoom, setIsNewRoom, newRoomDetails, setNewRoomDetails, isNewRoomFocused, setIsNewRoomFocused }}>
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