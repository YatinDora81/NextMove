"use client"
import { Sparkles, Check, Send, Copy } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Roles_AutoComplete } from '../Roles_AutoComplete'
import { Role, Template_Operation_Type, TemplateType } from '@/utils/api_types'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { GENERATE_AI_TEMPLATE } from '@/utils/url'
import { Loader2 } from 'lucide-react'

function Gen_AI_Template({ selectedRole, setSelectedRole, allRoles, templateData, setTemplateData }: { selectedRole: Role | null, setSelectedRole: (role: Role | null) => void, allRoles: Role[], templateData: Template_Operation_Type, setTemplateData: (templateData: Template_Operation_Type) => void }) {
    const [showResult, setShowResult] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const { getToken } = useAuth();
    const [history, setHistory] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [newData, setNewData] = useState<{ [key: string]: any } | null>(null);
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsCollapsed(true)
        }, 1000)

        return () => clearTimeout(timer)
    }, [])

    const generateMessage = async () => {
        try {
            setLoading(true)
            if (!prompt || prompt.trim().length === 0) {
                toast.error("Prompt is required")
                return
            }
            if (!selectedRole) {
                toast.error("Role is required")
                return
            }

            const res = await fetch(GENERATE_AI_TEMPLATE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await getToken()}`
                },
                body: JSON.stringify({
                    "type": "MESSAGE",
                    "content": prompt,
                    "roleName": selectedRole.name, // should be actual role name
                    "roleNameId": selectedRole.id,
                    "history": history
                })
            })

            const data = await res.json();
            if (!data || data.success === false) {
                toast.error(data.message || "Error generating message")
                return
            }

            setNewData(data.data.ai_data as TemplateType)

            setShowResult(true)
            setHistory([...history, prompt, JSON.stringify(data.data.ai_data)])
            setPrompt("");

        } catch (error) {
            console.log(error)
            toast.error("Error generating message")
        } finally {
            setLoading(false)
        }

    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setShowResult(false); }}>
            <DialogTrigger asChild>
                <motion.button
                    className="group relative rounded-md 
                               bg-primary text-primary-foreground
                               hover:bg-primary/90
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                               flex items-center h-8 px-3"
                    initial={false}
                    animate={{
                        paddingLeft: isCollapsed ? 8 : 12,
                        paddingRight: isCollapsed ? 8 : 12
                    }}
                    transition={{
                        duration: 2,
                        ease: [0.25, 0.1, 0.25, 1]
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Sparkles className="w-4 h-4 flex-shrink-0" />
                        <AnimatePresence mode="sync">
                            {!isCollapsed && (
                                <motion.span
                                    className="whitespace-nowrap text-sm font-medium overflow-hidden"
                                    initial={{ opacity: 1, width: 'auto' }}
                                    exit={{
                                        opacity: 0,
                                        width: 0,
                                        marginLeft: -8
                                    }}
                                    transition={{
                                        duration: 2,
                                        ease: [0.25, 0.1, 0.25, 1],
                                        opacity: { duration: 1.5, ease: "easeOut" },
                                        width: { duration: 2, ease: [0.25, 0.1, 0.25, 1] }
                                    }}
                                >
                                    Generate With AI
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.button>
            </DialogTrigger>
            <DialogContent>
                {!showResult ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5" />
                                Generate Template with AI
                            </DialogTitle>
                            <DialogDescription>
                                Describe what kind of template you want to generate
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex flex-col gap-2">
                            <Roles_AutoComplete selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} />
                        </div>

                        <div className="flex flex-col gap-4 mt-2">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="ai-prompt" className="text-black dark:text-white">
                                    What would you like to create?
                                </Label>
                                <Textarea
                                    id="ai-prompt"
                                    placeholder="e.g., A professional message template for reaching out to tech recruiters at startups..."
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="resize-none h-[120px] text-black dark:text-white"
                                    style={{ wordWrap: 'break-word', wordBreak: 'break-word', overflowWrap: 'break-word' }}
                                />
                            </div>

                            <Button
                                className="w-full flex items-center justify-center gap-2"
                                onClick={generateMessage}
                                disabled={loading}
                            >
                                {!loading ? <>
                                    <Sparkles className="w-4 h-4" />
                                    Generate with AI
                                </> :
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Generating...
                                    </>
                                }
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5" />
                                Generated Template
                            </DialogTitle>
                            <DialogDescription>
                                Review your template. You can refine it or use it as is.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex items-center gap-2">
                            <Label htmlFor="ai-prompt" className="text-black dark:text-white">
                                Selected Role:
                            </Label>
                            <div className="text-black dark:text-white">{selectedRole?.name}</div>
                        </div>

                        <div className="flex flex-col gap-4 mt-2">
                            {/* Generated template result */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-black dark:text-white">
                                    Generated Result
                                </Label>
                                <div className="relative p-3 pr-10 rounded-md border border-input bg-muted/30 dark:bg-input/20 min-h-[100px] text-sm text-black dark:text-white whitespace-pre-wrap">
                                    <button
                                        className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                                        title="Copy to clipboard"
                                        onClick={() => {
                                            navigator.clipboard.writeText(newData?.message as unknown as string || '')
                                            toast.success("Copied to clipboard")
                                        }}
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                    {newData?.message as unknown as string || ''}
                                </div>
                            </div>

                            {/* Refinement input */}
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Want changes? Tell AI here..."
                                    className="w-full h-10 pl-3 pr-10 rounded-md border border-input bg-background text-sm text-black dark:text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (!loading) generateMessage();
                                        }
                                    }}
                                />
                                <button
                                    className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    onClick={generateMessage}
                                    disabled={loading}
                                >
                                    {!loading ? <Send className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                                </button>
                            </div>

                            <Button
                                disabled={loading}
                                onClick={() => {
                                    setTemplateData({
                                        ...templateData,
                                        content: newData?.message as unknown as string || '',
                                        rules: newData?.rules as unknown as string[] || [],
                                        name: newData?.templateName as unknown as string || '',
                                        description: newData?.templateDescription as unknown as string || '',
                                    })
                                    setIsOpen(false)
                                }} className="w-full flex items-center justify-center gap-2">
                                <Check className="w-4 h-4" />
                                Use Template
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

export default Gen_AI_Template
