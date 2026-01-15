"use client"
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from '@/components/ui/input'
import { Label } from '@radix-ui/react-label'
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from '@/components/ui/button'
// import ModalContainer from '@/components/ModalContainer'
import { Role, TemplateType } from '@/utils/api_types'
import { Roles_AutoComplete } from '@/components/Roles_AutoComplete'
import { useTemplates } from '@/hooks/useTemplates'
import toast from 'react-hot-toast'
import { useAuth, useUser } from '@/hooks/useAuth'
import { capitalizeWords } from '@/utils/strings'
import { GENERATE_MESSAGE } from '@/utils/url'
import { EditIcon, RefreshCcwIcon } from 'lucide-react'
import EditName from '@/components/modals/EditName'
// import PreTemplates from '../public/role-templates-object.json'
import { useDevice } from '@/hooks/useDevice'

function GeneratePromt({ allRoles , predefinedTemplates }: { allRoles: Role[], predefinedTemplates: TemplateType[] }) {

    // const [openSearch, setOpenSearch] = useState<boolean>(true)
    const [selectedRole, setSelectedRole] = useState<Role | null>(null)
    const [roleWithTemplate, setRoleWithTemplate] = useState<TemplateType[]>(predefinedTemplates)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null)
    const { user } = useUser()
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const { getToken } = useAuth()
    const editBtnRef = useRef<HTMLButtonElement>(null)
    const { isLaptop } = useDevice()
    const [isAlreadyFilledForm, setIsAlreadyFilledForm] = useState<boolean>(false);

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
    }

    const submitHandler = () => {
        try {
            // if (formDetails.company.trim().length === 0 || formDetails.recruiterName.trim().length === 0) {
            //     toast.error("Company and Recruiter Name are required")
            //     return
            // }
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
            // if(selectedTemplate.content.includes("[Role]") && selectedTemplate.roleRelation.name.trim().length === 0){
            //     toast.error("Role is required")
            // }
            // Use global replace (/g flag) to replace ALL occurrences
            newMessage = newMessage.replace(/\[Recruiter Name\]/g, capitalizeWords(formDetails.recruiterName))
            newMessage = newMessage.replace(/\[Company Name\]/g, capitalizeWords(formDetails.company))
            newMessage = newMessage.replace(/\[Role\]/g, capitalizeWords(selectedTemplate.roleRelation.name))
            newMessage = newMessage.replace(/\[MY NAME\]/g, capitalizeWords(myName))

            console.log("Generated message:", newMessage)

            navigator.clipboard.writeText(newMessage)
            toast.success("Message copied.")
            if (!isAlreadyFilledForm) generateMessage(newMessage)
        } catch (error) {
            toast.error("Something went wrong")
            console.log(error)
        }
    }

    const generateMessage = async (message: string = "") => {
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
    }

    const selectedTemplateName = useMemo(() => {
        if (!selectedTemplate) return undefined
        if (!isLaptop && selectedTemplate.name.length > 25) {
            return selectedTemplate.name.slice(0, 25) + "..."
        }
        return selectedTemplate.name
    }, [selectedTemplate, isLaptop])

    return (
        <div className='  w-full h-screen flex justify-center items-center'>

            {/* {openSearch && <ModalContainer setOpen={setOpenSearch} />} */}

            <Card className=' min-w-[90%]  md:min-w-[70%] lg:min-w-[40%] h-fit '>
                <CardHeader className='flex items-center justify-between'>
                    <CardTitle className=' text-2xl font-semibold'>Generate Message</CardTitle>
                    <Button variant={"ghost"} size="icon" onClick={resetForm} aria-label='Reset form'>
                        <RefreshCcwIcon className="w-4 h-4" />
                    </Button>
                    {/* <CardDescription>Card Description</CardDescription> */}
                    {/* <CardAction>Card Action</CardAction>  */}
                </CardHeader>
                <CardContent>
                    <div className="mb-4 flex flex-col gap-2">
                        <Label htmlFor="email">Recruiter Name</Label>
                        <Input value={formDetails.recruiterName} onChange={(e) => {
                            setFormDetails({ ...formDetails, recruiterName: e.target.value })
                            setIsAlreadyFilledForm(false)
                        }} id="email" placeholder="e.g., John Smith" type="text" />
                    </div>


                    <div className="mb-4 flex items-center justify-between gap-2">
                        <div className=' w-[47%] self-end'>
                            <Roles_AutoComplete selectedRole={selectedRole} setSelectedRole={setSelectedRole} allRoles={allRoles} />
                        </div>
                        <div className=' w-[47%]'>
                            <Label htmlFor="roles">Template</Label>
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
                                <SelectTrigger className="w-full">
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
                        </div>
                    </div>


                    <div className="mb-2 flex flex-col gap-2">
                        <Label htmlFor="email">Company Name</Label>
                        <Input value={formDetails.company} onChange={(e) => {
                            setFormDetails({ ...formDetails, company: e.target.value })
                            setIsAlreadyFilledForm(false)
                        }} id="email" placeholder="e.g., Google, Microsoft" type="text" />
                    </div>




                    <div className="flex flex-col gap-2">

                        <div className=' w-[47%]  gap-2'>
                            {selectedTemplate && selectedTemplate.rules.find(rule => rule.rule === "[GENDER]") && <RadioGroup className=' flex ' defaultValue="male">
                                {/* preselect male */}
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="male" id="male" onChange={() => {
                                        setFormDetails({ ...formDetails, isMale: true })
                                        setIsAlreadyFilledForm(false)
                                    }} />
                                    <Label htmlFor="option-one">Male</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="female" id="female" onChange={() => {
                                        setFormDetails({ ...formDetails, isMale: false })
                                        setIsAlreadyFilledForm(false)
                                    }} />
                                    <Label htmlFor="option-two">Female</Label>
                                </div>
                            </RadioGroup>}
                        </div>



                        {/* Your Name */}

                        <div className="mb-4 flex flex-col gap-2">
                            <Label htmlFor="yourName">Your Name</Label>
                            <div className='flex gap-1'>
                                <Input className=' ' value={firstName + " " + lastName} disabled id="yourName" placeholder="Your full name" type="text" />
                                {/* <Button ref={editBtnRef} variant={"secondary"} onClick={() => { }} className=' ' size="icon"><RefreshCcwIcon className="w-4 h-4" /></Button> */}
                                <EditName><Button variant={"secondary"} className=' ' size="icon">
                                    <EditIcon className="w-4 h-4" />
                                </Button></EditName>
                            </div>
                        </div>

                        {/* <div>
                            <RadioGroup defaultValue="message" className=' flex'>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="message" id="message" />
                                    <Label htmlFor="message">Simple Message</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="email" id="email" />
                                    <Label htmlFor="email">Email Format</Label>
                                </div>
                            </RadioGroup>
                        </div> */}

                    </div>

                    {/* <div className="w-full flex flex-col gap-2 mt-3">
                        <Label htmlFor="roles">Resume</Label>
                        <Select>
                            <SelectTrigger className="w-full py-4 px-3 rounded-md border">
                                <SelectValue placeholder="Select Resume" />
                            </SelectTrigger>

                            <SelectContent className="rounded-md">
                                <SelectItem value="frontend" className="px-3 py-2 flex flex-col items-start">
                                    <span className="font-medium text-sm">Frontend Resume</span>
                                    <span className="text-xs text-muted-foreground">Uploaded: Jan 15, 2025</span>
                                </SelectItem>

                                <SelectItem value="backend" className="px-3 py-2 flex flex-col items-start">
                                    <span className="font-medium text-sm">Backend Resume</span>
                                    <span className="text-xs text-muted-foreground">Uploaded: Feb 2, 2025</span>
                                </SelectItem>

                                <SelectItem value="fullstack" className="px-3 py-2 flex flex-col items-start">
                                    <span className="font-medium text-sm">Full Stack Resume</span>
                                    <span className="text-xs text-muted-foreground">Uploaded: Mar 10, 2025</span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div> */}
                </CardContent>
                <CardFooter className=' mt-2'>
                    <Button onClick={submitHandler} className=' w-full'>Generate Message</Button>
                </CardFooter>
            </Card>
        </div>
    )
}

export default GeneratePromt
