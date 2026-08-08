"use client"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
    CheckIcon,
    ChevronsUpDownIcon,
    CopyIcon,
    EditIcon,
    RefreshCcwIcon,
} from "lucide-react"
import toast from "react-hot-toast"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/quiet/Button"
import { Card } from "@/components/quiet/Card"
import { Chip } from "@/components/quiet/Chip"
import { Field, Input } from "@/components/quiet/Field"
import { Kbd } from "@/components/quiet/Kbd"
import { cn } from "@/lib/utils"
import { Role, TemplateType } from "@/utils/api_types"
import { useTemplates } from "@/hooks/useTemplates"
import { useAuth, useUser } from "@/hooks/useAuth"
import { capitalizeWords } from "@/utils/strings"
import { GENERATE_MESSAGE } from "@/utils/url"
import EditName from "@/components/modals/EditName"
import { useDevice } from "@/hooks/useDevice"

const controlClass =
    "h-[38px] w-full rounded-lg border-hair2 bg-surface px-3 text-[13.5px] font-normal text-fg shadow-qsm"

function Block({
    label,
    hint,
    htmlFor,
    labelId,
    children,
}: {
    label: ReactNode
    hint?: ReactNode
    htmlFor?: string
    labelId?: string
    children: ReactNode
}) {
    return (
        <div className="mt-3.5">
            <label
                id={labelId}
                htmlFor={htmlFor}
                className="mb-1.5 flex justify-between text-[13px] font-medium text-fg"
            >
                <span>{label}</span>
                {hint && <span className="font-normal text-fg3">{hint}</span>}
            </label>
            {children}
        </div>
    )
}

function GeneratePromt({ allRoles , predefinedTemplates }: { allRoles: Role[], predefinedTemplates: TemplateType[] }) {

    const [selectedRole, setSelectedRole] = useState<Role | null>(null)
    const [roleWithTemplate, setRoleWithTemplate] = useState<TemplateType[]>(predefinedTemplates)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null)
    const { user } = useUser()
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const { getToken } = useAuth()
    const { isLaptop } = useDevice()
    const [isAlreadyFilledForm, setIsAlreadyFilledForm] = useState<boolean>(false);
    const [roleOpen, setRoleOpen] = useState(false)
    const [draft, setDraft] = useState<{ text: string; template: string } | null>(null)

    useEffect(() => {
        setFirstName(capitalizeWords(user?.firstName || ''))
        setLastName(capitalizeWords(user?.lastName || ''))
    }, [user])

    const [formDetails, setFormDetails] = useState<{
        recruiterName: string
        company: string
        isMale: boolean
    }>({
        recruiterName: "",
        company: "",
        isMale: false,
    })

    const { templates } = useTemplates()

    useEffect(() => {
        if (!selectedRole) {
            setRoleWithTemplate([])
            return
        }

        const dbTemplates = [...templates, ...predefinedTemplates].filter((template) => template.role === selectedRole.id)


        setRoleWithTemplate([...dbTemplates])
        setIsAlreadyFilledForm(false)
    }, [templates, selectedRole, predefinedTemplates])

    useEffect(() => {
        setSelectedTemplate(null)
    }, [selectedRole])

    const resetForm = () => {
        setFormDetails({
            recruiterName: "",
            company: "",
            isMale: false,
        })
        setSelectedRole(null)
        setSelectedTemplate(null)
        setIsAlreadyFilledForm(false)
        setDraft(null)
    }

    const generateMessage = useCallback(async (message: string = "") => {
        try {
            const token = await getToken()
            if (!token) {
                throw new Error("Token not found")
            }
            const bodyShouldBe: {
                "recruiterName": string,
                "role": string,
                "template": string,
                "company": string,
                "message": string,
                "gender": string,
                "messageType": "MESSAGE" | "EMAIL",
                "isNewCompany": boolean,
                "newCompanyName": string,
                "isNewRecruiter": boolean
            } = {
                recruiterName: capitalizeWords(formDetails.recruiterName),
                role: selectedRole?.id || "",
                template: selectedTemplate?.id || "",
                company: capitalizeWords(formDetails.company),
                message,
                gender: "",
                messageType: "MESSAGE",
                isNewCompany: true,
                isNewRecruiter: true,
                newCompanyName: capitalizeWords(formDetails.company),
            }
            const res = await fetch(GENERATE_MESSAGE, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(bodyShouldBe)
            })
            const data = await res.json()

            console.log(data)
            if (data.success) {
                console.log("Message generated successfully")
                setIsAlreadyFilledForm(true)
            } else {
                console.log(data.message)
            }
        } catch (error) {
            console.log("Error at sending request to generate message", error)
        }
    }, [getToken, formDetails, selectedRole, selectedTemplate])

    const submitHandler = useCallback(() => {
        try {
            if(!selectedRole){
                toast.error("Role is required")
                return
            }
            if (!selectedTemplate) {
                toast.error("Template is required")
                return
            }
            let myName = firstName
            if (lastName) {
                myName = myName + " " + lastName
            }

            let newMessage = selectedTemplate.content
            if(selectedTemplate.content.includes("[Recruiter Name]") && formDetails.recruiterName.trim().length === 0){
                toast.error("Recruiter Name is required")
                return
            }
            if(selectedTemplate.content.includes("[Company Name]") && formDetails.company.trim().length === 0){
                toast.error("Company Name is required")
                return
            }
            newMessage = newMessage.replace(/\[Recruiter Name\]/g, capitalizeWords(formDetails.recruiterName))
            newMessage = newMessage.replace(/\[Company Name\]/g, capitalizeWords(formDetails.company))
            newMessage = newMessage.replace(/\[Role\]/g, capitalizeWords(selectedTemplate.roleRelation.name))
            newMessage = newMessage.replace(/\[MY NAME\]/g, capitalizeWords(myName))

            console.log("Generated message:", newMessage)

            setDraft({ text: newMessage, template: selectedTemplate.name })
            navigator.clipboard.writeText(newMessage)
            toast.success("Message copied.")
            if (!isAlreadyFilledForm) generateMessage(newMessage)
        } catch (error) {
            toast.error("Something went wrong")
            console.log(error)
        }
    }, [selectedRole, selectedTemplate, firstName, lastName, formDetails, isAlreadyFilledForm, generateMessage])

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                submitHandler()
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [submitHandler])

    const selectedTemplateName = useMemo(() => {
        if (!selectedTemplate) return undefined
        if (!isLaptop && selectedTemplate.name.length > 25) {
            return selectedTemplate.name.slice(0, 25) + "..."
        }
        return selectedTemplate.name
    }, [selectedTemplate, isLaptop])

    const wordCount = useMemo(() => {
        if (!draft) return 0
        return draft.text.trim().split(/\s+/).filter(Boolean).length
    }, [draft])

    const copyDraft = () => {
        if (!draft) return
        navigator.clipboard.writeText(draft.text)
        toast.success("Message copied.")
    }

    const selectedRoleName = allRoles.find((role) => role.id === selectedRole?.id)?.name

    return (
        <div className="min-h-[calc(100vh-56px)] bg-bg px-6 pt-6 pb-12">
            <div className="mx-auto grid max-w-[1040px] items-start gap-4 lg:grid-cols-2">

                <Card className="p-5">
                    <div className="flex items-center gap-2">
                        <h1 className="text-base font-semibold tracking-[-0.01em] text-fg">New message</h1>
                        <Button
                            variant="ghost"
                            onClick={resetForm}
                            aria-label="Reset form"
                            className="ml-auto rounded-lg p-1.5"
                        >
                            <RefreshCcwIcon className="size-4" strokeWidth={1.5} />
                        </Button>
                    </div>

                    <Block label="Role" labelId="role-label">
                        <Popover open={roleOpen} onOpenChange={setRoleOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="sec"
                                    role="combobox"
                                    aria-expanded={roleOpen}
                                    aria-labelledby="role-label"
                                    className={cn(controlClass, "justify-between", !selectedRole && "text-fg3")}
                                >
                                    {selectedRole
                                        ? (isLaptop ? selectedRoleName : selectedRoleName?.slice(0, 10) + "...")
                                        : "Select Role..."}
                                    <ChevronsUpDownIcon className="size-4 shrink-0 text-fg3" strokeWidth={1.5} />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                                <Command>
                                    <CommandInput placeholder="Search Roles..." />
                                    <CommandList>
                                        <CommandEmpty>No Roles found...</CommandEmpty>
                                        <CommandGroup>
                                            {allRoles.map((role) => (
                                                <CommandItem
                                                    key={role.id}
                                                    value={role.name}
                                                    onSelect={(currentValue) => {
                                                        const selectedRoleData = allRoles.find(
                                                            (r) => r.name.toLowerCase() === currentValue.toLowerCase()
                                                        )
                                                        if (selectedRole?.id === selectedRoleData?.id) {
                                                            setSelectedRole(null)
                                                        } else {
                                                            setSelectedRole(selectedRoleData || null)
                                                        }
                                                        setRoleOpen(false)
                                                    }}
                                                >
                                                    <CheckIcon
                                                        className={cn(
                                                            "mr-2 size-4",
                                                            selectedRole?.id === role.id ? "opacity-100" : "opacity-0"
                                                        )}
                                                        strokeWidth={1.5}
                                                    />
                                                    {role.name}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </Block>

                    <Field label="Company">
                        <Input
                            value={formDetails.company}
                            onChange={(e) => {
                                setFormDetails({ ...formDetails, company: e.target.value })
                                setIsAlreadyFilledForm(false)
                            }}
                            id="company"
                            placeholder="e.g., Google, Microsoft"
                            type="text"
                        />
                    </Field>

                    <Field label="Recruiter" hint="optional">
                        <Input
                            value={formDetails.recruiterName}
                            onChange={(e) => {
                                setFormDetails({ ...formDetails, recruiterName: e.target.value })
                                setIsAlreadyFilledForm(false)
                            }}
                            id="recruiterName"
                            placeholder="e.g., John Smith"
                            type="text"
                        />
                    </Field>

                    <Block label="Template" labelId="template-label">
                        <Select
                            disabled={!selectedRole}
                            value={selectedTemplate?.id || ""}
                            onValueChange={(value) => {
                                const template = roleWithTemplate.find(t => t.id === value)
                                if (template) {
                                    setSelectedTemplate(template)
                                    setIsAlreadyFilledForm(false)
                                    console.log("Selected template:", template)
                                }
                            }}
                        >
                            <SelectTrigger
                                aria-labelledby="template-label"
                                className={cn(
                                    controlClass,
                                    "data-[size=default]:h-[38px] data-[placeholder]:text-fg3 dark:bg-surface dark:hover:bg-well",
                                    "focus-visible:border-hair2 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc",
                                    "[&_svg]:text-fg3"
                                )}
                            >
                                <SelectValue placeholder={selectedRole ? "Select Template" : "Select Role First"}>
                                    {isLaptop ? selectedTemplateName : selectedTemplate?.name.slice(0, 15) + "..."}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {roleWithTemplate.map((template) => (
                                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Block>

                    {selectedTemplate && selectedTemplate.rules.find(rule => rule.rule === "[GENDER]") && (
                        <Block label="Gender">
                            <RadioGroup className="flex gap-4" defaultValue="male">
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="male" id="male" onChange={() => {
                                        setFormDetails({ ...formDetails, isMale: true })
                                        setIsAlreadyFilledForm(false)
                                    }} />
                                    <label htmlFor="male" className="text-[13px] text-fg2">Male</label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="female" id="female" onChange={() => {
                                        setFormDetails({ ...formDetails, isMale: false })
                                        setIsAlreadyFilledForm(false)
                                    }} />
                                    <label htmlFor="female" className="text-[13px] text-fg2">Female</label>
                                </div>
                            </RadioGroup>
                        </Block>
                    )}

                    <Block label="Your name" htmlFor="yourName">
                        <div className="flex items-center gap-2">
                            <Input value={firstName + " " + lastName} disabled id="yourName" placeholder="Your full name" type="text" />
                            <EditName>
                                <span className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-hair2 bg-surface text-fg2 shadow-qsm transition-colors hover:bg-well hover:text-fg">
                                    <EditIcon className="size-4" strokeWidth={1.5} />
                                    <span className="sr-only">Edit your name</span>
                                </span>
                            </EditName>
                        </div>
                    </Block>

                    <Button variant="acc" onClick={submitHandler} className="mt-4 w-full py-2.5">
                        Generate
                        <Kbd className="border-white/30! bg-white/15! text-inherit!">⌘↵</Kbd>
                    </Button>
                    <p className="mt-2.5 text-center text-xs text-fg3">
                        Fills your template · copies to your clipboard
                    </p>
                </Card>

                <Card className="overflow-hidden">
                    <div className="flex items-center gap-2.5 border-b border-hair px-4 py-3">
                        <span className={cn("size-1.5 rounded-full", draft ? "bg-ok" : "bg-fg3")} />
                        <span className="text-sm font-semibold text-fg">Draft</span>
                        {draft && <span className="truncate text-xs text-fg2">{draft.template}</span>}
                        {isAlreadyFilledForm && (
                            <Chip tone="ok" className="ml-auto shrink-0">Saved to Applied</Chip>
                        )}
                    </div>

                    {draft ? (
                        <div className="max-h-[520px] overflow-y-auto px-5 py-4 text-sm leading-[1.75] whitespace-pre-wrap text-fg">
                            {draft.text}
                        </div>
                    ) : (
                        <div className="px-5 py-4 text-[13.5px] leading-[1.7] text-fg2">
                            Pick a role and a template, then press Generate. Your message lands here and on your clipboard.
                        </div>
                    )}

                    <div className="flex items-center gap-2 border-t border-hair px-4 py-3">
                        <Button
                            variant="sec"
                            onClick={copyDraft}
                            disabled={!draft}
                            className="gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px]"
                        >
                            <CopyIcon className="size-[13px]" strokeWidth={1.5} />
                            Copy
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={submitHandler}
                            disabled={!draft}
                            className="gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px]"
                        >
                            <RefreshCcwIcon className="size-[13px]" strokeWidth={1.5} />
                            Regenerate
                        </Button>
                        <span className="tnum ml-auto text-xs text-fg2">{wordCount} words</span>
                    </div>
                </Card>

            </div>
        </div>
    )
}

export default GeneratePromt
