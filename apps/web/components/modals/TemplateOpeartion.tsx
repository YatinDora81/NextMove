"use client"
import React, { ReactNode, useEffect, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from '@radix-ui/react-label'
import { Switch } from "@/components/ui/switch"
import { Button } from '@/components/quiet/Button'
import { Input, Textarea } from '@/components/quiet/Field'
import { Well } from '@/components/quiet/Card'
import toast from 'react-hot-toast'
import { Copy, CheckCircle2, Info } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Role, Template_Operation_Type, TemplateType } from '@/utils/api_types'
import { Roles_AutoComplete } from '../Roles_AutoComplete'
import { ADD_NEW_TEMPLATE, UPDATE_TEMPLATE } from '@/utils/url'
import { useAuth } from '@/hooks/useAuth'
import { useTemplates } from '@/hooks/useTemplates'
import Gen_AI_Template from './Gen_AI_Template'

const rules = [
    {
        name: "[Recruiter Name]",
        defaultValue: true
    },
    {
        name: "[Company Name]",
        defaultValue: true
    },
    // {
    //     name: "[Gender]",
    //     defaultValue: false
    // }
]

const labelClass = "text-[13px] font-medium text-fg"
const codeClass = "font-mono rounded-sm bg-well px-1.5 py-0.5 text-fg"

function TemplateOpeartion({ children, isUpdate = false, currData = null, allRoles }: { children: ReactNode, isUpdate?: boolean, currData?: TemplateType | null, allRoles: Role[] }) {

    const { getToken } = useAuth();
    const { setTemplates, templates } = useTemplates()
    const [open, setOpen] = useState(false)
    const [successDialogOpen, setSuccessDialogOpen] = useState(false)
    const [createdTemplate, setCreatedTemplate] = useState<TemplateType | null>(null)
    const [templateData, setTemplateData] = useState<Template_Operation_Type>({
        content: '',
        description: '',
        name: '',
        type: 'MESSAGE',
        role: '',
        rules: [],
    })
    const [selectedRole, setSelectedRole] = useState<Role | null>(null)
    const [exampleIndex, setExampleIndex] = useState(0)

    const exampleMessages = [
        "Hi [Recruiter Name], I'm [MY NAME], a Frontend Developer. Any openings at [Company Name] you could refer me for?",
        "Hey [Recruiter Name]! I'm [MY NAME], looking for Backend roles. Would love a referral if there's an opening at [Company Name].",
        "Hi [Recruiter Name], this is [MY NAME]. Are there any Full Stack positions at [Company Name]? Would appreciate a referral!",
        "Hello [Recruiter Name], I'm [MY NAME]. Looking for DevOps roles - any opportunities at [Company Name] you could connect me with?",
        "Hi [Recruiter Name]! I'm [MY NAME], interested in Data Science roles at [Company Name]. Could you refer me if there's an opening?"
    ]

    useEffect(() => {
        if (open && isUpdate && currData) {
            setTemplateData({
                content: currData.content || '',
                description: currData.description || '',
                name: currData.name || '',
                type: currData.type || 'MESSAGE',
                role: currData.role || '',
                rules: currData.rules && rules.filter((r) => r.defaultValue).map((r) => r.name)
                    || []
            })

            if (currData.role) {
                const role = allRoles.find(r => r.id === currData.role)
                if (role) {
                    setSelectedRole(role)
                }
            }
        }
    }, [open, isUpdate, currData, allRoles])

    useEffect(() => {
        if (selectedRole) {
            setTemplateData(prev => ({ ...prev, role: selectedRole.id }))
        }
    }, [selectedRole])

    const submitHandler = async () => {
        try {

            if (templateData.content.trim() === "") {
                toast.error("Content is required")
                return
            }
            if (!templateData.content.includes("[Recruiter Name]") && templateData.rules.includes("[Recruiter Name]")) {
                toast.error("[Recruiter Name] is not present in the content")
                return
            }
            if (!templateData.content.includes("[Company Name]") && templateData.rules.includes("[Company Name]")) {
                toast.error("[Company Name] is not present in the content")
                return
            }
            if (templateData.name.trim() === "") {
                toast.error("Name is required")
                return
            }
            if (templateData.role.trim() === "") {
                toast.error("Role is required")
                return
            }
            if (templateData.type.trim() === "") {
                toast.error("Type is required")
                return
            }

            if (isUpdate && !currData) {
                toast.error("Something went wrong")
                return
            }
            const updateTargetId = currData?.id

            const token = await getToken()

            const res = await fetch(!isUpdate ? ADD_NEW_TEMPLATE : UPDATE_TEMPLATE, {
                method: !isUpdate ? "POST" : "PUT",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(!isUpdate ? templateData : {
                    ...templateData,
                    templateId: updateTargetId,
                    isRulesChanged: true,
                })
            })

            const data = await res.json();

            if (!data.success) {
                toast.error(data.message || "Something went wrong!!!")
                return
            }

            const newTemplate = data.data.template as TemplateType
            if (!isUpdate) {
                setTemplates([newTemplate, ...templates])
            } else {

                const existingTemplate = templates.find((t) => t.id === updateTargetId)
                const updatedTemplate = existingTemplate && !newTemplate.roleRelation
                    ? { ...newTemplate, roleRelation: existingTemplate.roleRelation }
                    : newTemplate
                setTemplates(templates.map((t) => t.id === updateTargetId ? updatedTemplate : t))
            }
            toast.success(data.message || (isUpdate ? "Template updated successfully" : "Template added successfully"))

            setOpen(false)
            setCreatedTemplate(newTemplate)
            setSuccessDialogOpen(true)

            if (!isUpdate) {
                setTemplateData({
                    content: '',
                    description: '',
                    name: '',
                    type: 'MESSAGE',
                    role: '',
                    rules: rules.filter((r) => r.defaultValue).map((r) => r.name),
                })
                setSelectedRole(null)
            }

        } catch (error) {
            toast.error("Something went wrong")
            console.log('Errorr at adding or modifying template', error)
        }
    }

    useEffect(() => {
        rules.forEach((r) => {
            if (r.defaultValue) {
                setTemplateData(prev => ({ ...prev, rules: [...prev.rules, r.name] }))
            }
        })
    }, [])

    useEffect(() => {
        if (!open && !isUpdate) {
            setTemplateData({
                content: '',
                description: '',
                name: '',
                type: 'MESSAGE',
                role: '',
                rules: rules.filter((r) => r.defaultValue).map((r) => r.name),
            })
            setSelectedRole(null)
        }
    }, [open, isUpdate])

    useEffect(() => {
        const interval = setInterval(() => {
            setExampleIndex((prev) => (prev + 1) % exampleMessages.length)
        }, 3000)
        return () => clearInterval(interval)
    }, [exampleMessages.length])

    const copyToClipboard = () => {
        if (createdTemplate?.content) {
            navigator.clipboard.writeText(createdTemplate.content)
            toast.success('Copied')
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger>{children}</DialogTrigger>
                <DialogContent className="rounded-xl border-hair bg-surface shadow-qmd">
                    <DialogHeader>
                        <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-fg">{!isUpdate ? 'Create New Template' : 'Update Template'}</DialogTitle>
                        <DialogDescription className="text-fg2">

                            <div className="my-4 flex flex-col items-start gap-1.5 overflow-auto">
                                <Label htmlFor="name" className={labelClass}>Template Name</Label>
                                <Input id="name" value={templateData.name} onChange={(e) => setTemplateData({ ...templateData, name: e.target.value })} placeholder="e.g., Friend Referral - Full Stack" type='text' />
                            </div>

                            <div className="my-4 flex max-w-[100%] flex-col items-start gap-1.5 overflow-auto">
                                <div className="flex w-full items-center gap-2">
                                    <Label htmlFor="tempp" className={labelClass}>Template Content</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <button className="rounded-md p-1 text-fg3 transition-colors hover:bg-well hover:text-fg2" aria-label="How to write a template">
                                                <Info className="size-4" strokeWidth={1.5} />
                                            </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72 max-w-[90vw] rounded-xl border-hair bg-surface shadow-qmd" side="bottom" align="start">
                                            <div className="space-y-3">
                                                <div className="text-[13px] font-medium text-fg">How to write template</div>
                                                <p className="text-xs leading-[1.6] text-fg2">
                                                    Use placeholders in your template. These will be replaced with actual values when you send the message.
                                                </p>
                                                <div className="space-y-2 text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <code className={codeClass}>[Recruiter Name]</code>
                                                        <span className="text-fg2">→ Recipient&apos;s name</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <code className={codeClass}>[MY NAME]</code>
                                                        <span className="text-fg2">→ Your name</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <code className={codeClass}>[Company Name]</code>
                                                        <span className="text-fg2">→ Company name</span>
                                                    </div>
                                                </div>
                                                <div className="border-t border-hair pt-2">
                                                    <div className="mb-2 flex items-center justify-between">
                                                        <span className="text-xs font-medium text-fg">Examples</span>
                                                        <div className="flex gap-1">
                                                            {exampleMessages.map((_, i) => (
                                                                <div
                                                                    key={i}
                                                                    className={`size-1.5 rounded-full transition-colors ${i === exampleIndex ? 'bg-fg2' : 'bg-hair2'}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <Well className="min-h-[50px] p-2 text-xs leading-[1.6] text-fg2">
                                                        {exampleMessages[exampleIndex]}
                                                    </Well>
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                    <div className="ml-auto">
                                        <Gen_AI_Template selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} templateData={templateData} setTemplateData={setTemplateData} />
                                    </div>
                                </div>
                                <Textarea id="tempp" value={templateData.content} onChange={(e) => setTemplateData({ ...templateData, content: e.target.value })} placeholder="Hi [Recruiter Name], I'm [MY NAME] looking for opportunities at [Company Name]..." wrap="soft" className='h-[25vh] w-full resize-none overflow-y-auto leading-[1.6] break-words whitespace-normal' style={{ wordWrap: 'break-word', wordBreak: 'break-word', overflowWrap: 'break-word' }} />

                                {/* Rotating example messages */}
                                <div className="w-full">
                                    <div className="mb-1.5 flex items-center justify-between">
                                        <span className="text-xs text-fg2">Example</span>
                                        <div className="flex gap-1">
                                            {exampleMessages.map((_, i) => (
                                                <div
                                                    key={i}
                                                    className={`size-1.5 rounded-full transition-colors ${i === exampleIndex ? 'bg-fg2' : 'bg-hair2'}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <Well className="px-3 py-2 text-xs leading-[1.6] text-fg2">
                                        {exampleMessages[exampleIndex]}
                                    </Well>
                                </div>
                            </div>

                            <div className=' w-full flex items-center justify-between'>
                                <div className=' w-[47%] flex flex-col gap-1'>
                                    <Roles_AutoComplete selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} />

                                </div>

                                {/* Message or Email radio btn */}
                                <div className=' w-[47%] flex flex-col gap-1'>
                                    <Label className={labelClass}>Type</Label>
                                    <RadioGroup value={templateData.type} onValueChange={(value) => setTemplateData({ ...templateData, type: value as "MESSAGE" | "EMAIL" })} className=' flex'>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="MESSAGE" id="message" />
                                            <Label htmlFor="message" className="text-[13px] text-fg">Message</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="EMAIL" id="email" />
                                            <Label htmlFor="email" className="text-[13px] text-fg">Email</Label>
                                        </div>
                                    </RadioGroup>
                                </div>

                            </div>

                            <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                                <div className={labelClass}>Rules</div>
                                {
                                    rules.map((r, i) => <div key={i} className=' flex  justify-start items-start  gap-2'>
                                        <Switch id='rule-1' checked={templateData.rules.includes(r.name)} onCheckedChange={(checked) => {
                                            if (checked) {
                                                setTemplateData({ ...templateData, rules: [...templateData.rules, r.name] })
                                            } else {
                                                setTemplateData({ ...templateData, rules: templateData.rules.filter((rule) => rule !== r.name) })
                                            }
                                        }}></Switch>
                                        <Label htmlFor='rule-1' className="text-[13px] text-fg">{r.name}</Label>
                                    </div>)
                                }
                            </div>

                            <div className='flex w-full justify-evenly items-center gap-3'>
                                {isUpdate && <Button onClick={() => setOpen(false)} className='w-[48%]' variant="sec">Cancel</Button>}
                                <Button variant="acc" onClick={submitHandler} className={`${isUpdate ? 'w-[48%] ' : 'w-full'}`}>{isUpdate ? 'Update Template' : 'Save Template'}</Button>
                            </div>

                        </DialogDescription>
                    </DialogHeader>
                </DialogContent>
            </Dialog>

            {/* Success Dialog */}
            <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
                <DialogContent className="rounded-xl border-hair bg-surface shadow-qmd">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.015em] text-fg">
                            <CheckCircle2 className="size-4 text-ok" strokeWidth={1.5} />
                            Template {isUpdate ? 'Updated' : 'Created'} Successfully!
                        </DialogTitle>
                        <DialogDescription className="text-fg2">
                            {createdTemplate && (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <Label className={labelClass}>Template Name</Label>
                                        <Well className='mt-2 p-3 text-[15px] font-semibold capitalize text-fg'>{createdTemplate.name}</Well>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <Label className={labelClass}>Template Content</Label>
                                            <Button
                                                variant="ghost"
                                                onClick={copyToClipboard}
                                                className="px-2 py-[5px]"
                                                aria-label="Copy to clipboard"
                                                title="Copy to clipboard"
                                            >
                                                <Copy className="size-[13px]" strokeWidth={1.5} />
                                            </Button>
                                        </div>
                                        <p className="mt-2 rounded-[10px] bg-well p-3 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-fg">{createdTemplate.content}</p>
                                    </div>

                                    {/* How to use section */}
                                    <Well className="mt-4 p-3">
                                        <div className="mb-2 text-[13px] font-medium text-fg">How to use</div>
                                        <div className="space-y-1 text-xs leading-[1.6] text-fg2">
                                            <p>Replace the placeholders before sending:</p>
                                            <ul className="mt-1 list-inside list-disc space-y-0.5">
                                                <li><span className="font-mono rounded-sm border border-hair bg-surface px-1 text-fg">[Recruiter Name]</span> → Actual name (e.g., John)</li>
                                                <li><span className="font-mono rounded-sm border border-hair bg-surface px-1 text-fg">[MY NAME]</span> → Your name</li>
                                                <li><span className="font-mono rounded-sm border border-hair bg-surface px-1 text-fg">[Company Name]</span> → Company name (e.g., Google)</li>
                                            </ul>
                                        </div>
                                    </Well>
                                </div>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                </DialogContent>
            </Dialog>
        </>
    )
}

export default TemplateOpeartion;
