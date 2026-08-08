"use client"
import { Sparkles, Check, Send, Copy } from 'lucide-react'
import React, { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from '@/components/quiet/Button'
import { Input, Textarea } from '@/components/quiet/Field'
import { Well } from '@/components/quiet/Card'
import { Label } from '../ui/label'
import { Roles_AutoComplete } from '../Roles_AutoComplete'
import { Role, Template_Operation_Type } from '@/utils/api_types'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { GENERATE_AI_TEMPLATE } from '@/utils/url'
import { Loader2 } from 'lucide-react'

type AiGeneratedTemplate = {
    message?: string
    rules?: string[]
    templateName?: string
    templateDescription?: string
}

function Gen_AI_Template({ selectedRole, setSelectedRole, allRoles, templateData, setTemplateData }: { selectedRole: Role | null, setSelectedRole: (role: Role | null) => void, allRoles: Role[], templateData: Template_Operation_Type, setTemplateData: (templateData: Template_Operation_Type) => void }) {
    const [showResult, setShowResult] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const { getToken } = useAuth();
    const [history, setHistory] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [newData, setNewData] = useState<AiGeneratedTemplate | null>(null);

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

            setNewData(data.data.ai_data as AiGeneratedTemplate)

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
                <Button variant="sec" className="h-8 gap-1.5 px-2.5 py-1 text-[12.5px]">
                    <Sparkles className="size-[13px]" strokeWidth={1.5} />
                    Generate with AI
                </Button>
            </DialogTrigger>
            <DialogContent className="rounded-xl border-hair bg-surface shadow-qmd">
                {!showResult ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.015em] text-fg">
                                <Sparkles className="size-4 text-fg2" strokeWidth={1.5} />
                                Generate Template with AI
                            </DialogTitle>
                            <DialogDescription className="text-[13px] text-fg2">
                                Describe what kind of template you want to generate
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex flex-col gap-2">
                            <Roles_AutoComplete selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} />
                        </div>

                        <div className="mt-2 flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="ai-prompt" className="text-[13px] font-medium text-fg">
                                    What would you like to create?
                                </Label>
                                <Textarea
                                    id="ai-prompt"
                                    placeholder="e.g., A professional message template for reaching out to tech recruiters at startups..."
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="h-[120px] resize-none leading-[1.6]"
                                    style={{ wordWrap: 'break-word', wordBreak: 'break-word', overflowWrap: 'break-word' }}
                                />
                            </div>

                            <Button
                                variant="acc"
                                className="w-full"
                                onClick={generateMessage}
                                disabled={loading}
                            >
                                {!loading ? <>
                                    <Sparkles className="size-4" strokeWidth={1.5} />
                                    Generate with AI
                                </> :
                                    <>
                                        <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
                                        Generating...
                                    </>
                                }
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.015em] text-fg">
                                <Sparkles className="size-4 text-fg2" strokeWidth={1.5} />
                                Generated Template
                            </DialogTitle>
                            <DialogDescription className="text-[13px] text-fg2">
                                Review your template. You can refine it or use it as is.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex items-center gap-2">
                            <Label htmlFor="ai-prompt" className="text-[13px] font-medium text-fg">
                                Selected Role:
                            </Label>
                            <div className="text-[13px] text-fg2">{selectedRole?.name}</div>
                        </div>

                        <div className="mt-2 flex flex-col gap-4">
                            {/* Generated template result */}
                            <div className="flex flex-col gap-1.5">
                                <Label className="text-[13px] font-medium text-fg">
                                    Generated Result
                                </Label>
                                <Well className="relative min-h-[100px] p-3 pr-10 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-fg">
                                    <Button
                                        variant="ghost"
                                        className="absolute top-2 right-2 px-2 py-[5px]"
                                        aria-label="Copy to clipboard"
                                        title="Copy to clipboard"
                                        onClick={() => {
                                            navigator.clipboard.writeText(newData?.message || '')
                                            toast.success("Copied to clipboard")
                                        }}
                                    >
                                        <Copy className="size-[13px]" strokeWidth={1.5} />
                                    </Button>
                                    {newData?.message || ''}
                                </Well>
                            </div>

                            {/* Refinement input */}
                            <div className="relative">
                                <Input
                                    type="text"
                                    placeholder="Want changes? Tell AI here..."
                                    className="pr-11"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (!loading) generateMessage();
                                        }
                                    }}
                                />
                                <Button
                                    variant="ghost"
                                    className="absolute top-1/2 right-1 -translate-y-1/2 px-2 py-[5px]"
                                    aria-label="Send"
                                    onClick={generateMessage}
                                    disabled={loading}
                                >
                                    {!loading ? <Send className="size-4" strokeWidth={1.5} /> : <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />}
                                </Button>
                            </div>

                            <Button
                                variant="acc"
                                disabled={loading}
                                onClick={() => {
                                    setTemplateData({
                                        ...templateData,
                                        content: newData?.message || '',
                                        rules: newData?.rules || [],
                                        name: newData?.templateName || '',
                                        description: newData?.templateDescription || '',
                                    })
                                    setIsOpen(false)
                                }} className="w-full">
                                <Check className="size-4" strokeWidth={1.5} />
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
