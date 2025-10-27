/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

import { TemplateType } from "@/utils/api_types";
import { GET_ALL_TEMPLATES } from "@/utils/url";
import { useAuth } from "@clerk/nextjs";
import { createContext, useContext, useEffect, useState } from "react"
import toast from "react-hot-toast";

type TemplateContextType = {
    templates: TemplateType [],
    setTemplates: (templates: TemplateType[]) => void,
    isTemplateLoading: boolean,
    setIsTemplateLoading: (isTemplateLoading: boolean) => void,
    fetchTemplates: () => Promise<void>,
}

const TemplateContext = createContext<TemplateContextType | null>(null);

export const TemplateProvider = ({ children }: { children: React.ReactNode }) => {

    const [templates, setTemplates] = useState<TemplateType[]>([]);
    const [isTemplateLoading, setIsTemplateLoading] = useState(false);
    const { getToken } = useAuth()

    const fetchTemplates = async () => {
        try {
            setIsTemplateLoading(true);
            const token = await getToken({ template: "frontend_token" })
            if (!token) {
                throw new Error("Token not found")
            }
            const res = await fetch(GET_ALL_TEMPLATES, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            })
            const data = await res.json()
            if (!data.success) {
                toast.error(data.message || "Something went wrong")
                return
            }
            else setTemplates(data.data)
        } catch (error) {
            toast.error((error as Error).message || "Something went wrong")
            return
        }
        finally {
            setIsTemplateLoading(false);
        }
    }

    useEffect(() => {
        fetchTemplates()
    }, [])

    return (
        <TemplateContext.Provider value={{ templates, setTemplates, isTemplateLoading, setIsTemplateLoading, fetchTemplates }}>
            {children}
        </TemplateContext.Provider>
    )
}

export const useTemplates = () => {
    const context = useContext(TemplateContext)
    if (!context) {
        throw new Error("useTemplates must be used within a TemplateProvider")
    }
    return context
}