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
import { Input } from '@/components/ui/input'
import { Label } from '@radix-ui/react-label'
import { Textarea } from '../ui/textarea'
import { Switch } from "@/components/ui/switch"
import { Button } from '../ui/button'
import toast from 'react-hot-toast'
import { Copy, CheckCircle2 } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Role, Template_Operation_Type, TemplateType } from '@/utils/api_types'
import { Roles_AutoComplete } from '../Roles_AutoComplete'
import { ADD_NEW_TEMPLATE, UPDATE_TEMPLATE } from '@/utils/url'
import { useAuth } from '@clerk/nextjs'
import { useTemplates } from '@/hooks/useTemplates'
import Gen_AI_Template from './Gen_AI_Template'

function TemplateOpeartion({ children, isUpdate = false, currData = null, allRoles }: { children: ReactNode, isUpdate?: boolean, currData?: any, allRoles: Role[] }) {

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

    // Load data when dialog opens in update mode
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
            // Find and set the selected role from allRoles
            if (currData.role) {
                const role = allRoles.find(r => r.id === currData.role)
                if (role) {
                    setSelectedRole(role)
                }
            }
        }
    }, [open, isUpdate, currData, allRoles])

    // Update templateData when selectedRole changes
    useEffect(() => {
        if (selectedRole) {
            setTemplateData(prev => ({ ...prev, role: selectedRole.id }))
        }
    }, [selectedRole])

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
            const token = await getToken({ template: "frontend_token" })

            const res = await fetch(!isUpdate ? ADD_NEW_TEMPLATE : UPDATE_TEMPLATE, {
                method: !isUpdate ? "POST" : "PUT",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(!isUpdate ? templateData : {
                    ...templateData,
                    templateId: currData.id,
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
                // Preserve roleRelation from existing template if new template doesn't have it
                const existingTemplate = templates.find((t) => t.id === currData.id)
                const updatedTemplate = existingTemplate && !newTemplate.roleRelation
                    ? { ...newTemplate, roleRelation: existingTemplate.roleRelation }
                    : newTemplate
                setTemplates(templates.map((t) => t.id === currData.id ? updatedTemplate : t))
            }
            toast.success(data.message || (isUpdate ? "Template updated successfully" : "Template added successfully"))

            // Close main dialog and open success dialog
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

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Reset form when dialog closes (only for create mode)
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isUpdate])

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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{!isUpdate ? 'Create New Template' : 'Update Template'}</DialogTitle>
                        <DialogDescription>


                            <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                                <Label htmlFor="name" className="text-black dark:text-white">Template Name</Label>
                                <Input id="name" value={templateData.name} onChange={(e) => setTemplateData({ ...templateData, name: e.target.value })} placeholder="For CEO of Company" type='text' className="text-black dark:text-white" />
                            </div>

                            <div className="my-4 relative flex flex-col items-start gap-2 overflow-auto max-w-[100%]">
                                <Label htmlFor="tempp" className="text-black dark:text-white">Template Description</Label>
                                <div className=' absolute right-1 top-8'> <Gen_AI_Template selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} templateData={templateData} setTemplateData={setTemplateData} /> </div>
                                <Textarea id="tempp" value={templateData.content} onChange={(e) => setTemplateData({ ...templateData, content: e.target.value })} placeholder="Hi [Recruiter Name] i want to join your [Company]" wrap="soft" className=' resize-none h-[25vh] overflow-y-auto whitespace-normal break-words text-black dark:text-white w-full' style={{ wordWrap: 'break-word', wordBreak: 'break-word', overflowWrap: 'break-word' }} />
                            </div>

                            <div className=' w-full flex items-center justify-between'>
                                <div className=' w-[47%] flex flex-col gap-1'>
                                    <Roles_AutoComplete selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} />

                                </div>

                                {/* <div className=' w-[47%] flex flex-col gap-1'>
                                <Label htmlFor="genderr ">Gender</Label>
                                <Select defaultValue='NotDependant'>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Gender" />
                                    </SelectTrigger>
                                    <SelectContent >
                                        <SelectItem value="Male">Male</SelectItem>
                                        <SelectItem value="Female">Female</SelectItem>
                                        <SelectItem value="NotDependant" >Not Dependent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div> */}

                                {/* Message or Email radio btn */}
                                <div className=' w-[47%] flex flex-col gap-1'>
                                    <Label className="text-black dark:text-white">Type</Label>
                                    <RadioGroup value={templateData.type} onValueChange={(value) => setTemplateData({ ...templateData, type: value as "MESSAGE" | "EMAIL" })} className=' flex'>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="MESSAGE" id="message" />
                                            <Label htmlFor="message" className="text-black dark:text-white">Message</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="EMAIL" id="email" />
                                            <Label htmlFor="email" className="text-black dark:text-white">Email</Label>
                                        </div>
                                    </RadioGroup>
                                </div>

                            </div>


                            <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                                <div className="text-black dark:text-white">Rules</div>
                                {
                                    rules.map((r, i) => <div key={i} className=' flex  justify-start items-start  gap-2'>
                                        <Switch id='rule-1' checked={templateData.rules.includes(r.name)} onCheckedChange={(checked) => {
                                            if (checked) {
                                                setTemplateData({ ...templateData, rules: [...templateData.rules, r.name] })
                                            } else {
                                                setTemplateData({ ...templateData, rules: templateData.rules.filter((rule) => rule !== r.name) })
                                            }
                                        }}></Switch>
                                        <Label htmlFor='rule-1' className="text-black dark:text-white">{r.name}</Label>
                                    </div>)
                                }
                            </div>

                            <div className='flex w-full justify-evenly items-center'>
                                {isUpdate && <Button onClick={() => setOpen(false)} className='w-[48%] hover:text-red-500 ' variant={'outline'}>Cancel</Button>}
                                <Button onClick={submitHandler} className={`${isUpdate ? 'w-[48%] ' : 'w-full'}`}>{isUpdate ? 'Update Template' : 'Save Template'}</Button>
                            </div>

                        </DialogDescription>
                    </DialogHeader>
                </DialogContent>
            </Dialog>

            {/* Success Dialog */}
            <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            Template {isUpdate ? 'Updated' : 'Created'} Successfully!
                        </DialogTitle>
                        <DialogDescription>
                            {createdTemplate && (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <Label className="font-semibold">Template Name:</Label>
                                        <div className='mt-2 p-3 bg-gray-100/50 dark:bg-zinc-800/30 rounded-md font-semibold text-lg capitalize text-black dark:text-white'>{createdTemplate.name}</div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <Label className="font-semibold text-black dark:text-white">Template Content:</Label>
                                            <button
                                                onClick={copyToClipboard}
                                                className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
                                                title="Copy to clipboard"
                                            >
                                                <Copy className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <p className="mt-2 p-3 bg-gray-100/50 dark:bg-zinc-800/30 rounded-md whitespace-pre-wrap text-black dark:text-white">{createdTemplate.content}</p>
                                    </div>
                                    {/* <div>
                                    <Label className="font-semibold">Type:</Label>
                                    <p>{createdTemplate.type}</p>
                                </div> */}
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