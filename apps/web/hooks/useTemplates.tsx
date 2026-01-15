"use client"

import { TemplateType } from "@/utils/api_types";
import { GET_ALL_TEMPLATES, DELETE_TEMPLATE } from "@/utils/url";
import { useAuth } from "@/hooks/useAuth";
import { createContext, useContext, useEffect, useState } from "react"
import toast from "react-hot-toast";

type TemplateContextType = {
    templates: TemplateType [],
    setTemplates: (templates: TemplateType[]) => void,
    isTemplateLoading: boolean,
    setIsTemplateLoading: (isTemplateLoading: boolean) => void,
    fetchTemplates: () => Promise<void>,
    deleteTemplate: (templateId: string) => Promise<void>,
}

const TemplateContext = createContext<TemplateContextType | null>(null);

export const TemplateProvider = ({ children }: { children: React.ReactNode }) => {

    const [templates, setTemplates] = useState<TemplateType[]>([]);
    const [isTemplateLoading, setIsTemplateLoading] = useState(false);
    const { getToken } = useAuth()

    const fetchTemplates = async () => {
        try {
            setIsTemplateLoading(true);
            const token = await getToken()
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

    const deleteTemplate = async (templateId: string) => {
        try {
            const token = await getToken()
            if (!token) {
                throw new Error("Token not found")
            }
            const res = await fetch(DELETE_TEMPLATE, {
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ templateId })
            })
            const data = await res.json()
            if (!data.success) {
                toast.error(data.message || "Something went wrong")
                return
            }
            toast.success(data.message || "Template deleted successfully")
            // Refresh templates after deletion
            // await fetchTemplates()
            setTemplates(templates.filter((template) => template.id !== templateId))
            
        } catch (error) {
            toast.error((error as Error).message || "Something went wrong")
        }
    }

    useEffect(() => {
        fetchTemplates()
    }, [])

    return (
        <TemplateContext.Provider value={{ templates, setTemplates, isTemplateLoading, setIsTemplateLoading, fetchTemplates, deleteTemplate }}>
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