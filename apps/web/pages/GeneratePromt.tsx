"use client"
import React, { useEffect, useState } from 'react'
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
import { useUser } from '@clerk/nextjs'
import { capitalizeWords } from '@/utils/strings'

function GeneratePromt({ allRoles }: { allRoles: Role[] }) {

    // const [openSearch, setOpenSearch] = useState<boolean>(true)
    const [selectedRole, setSelectedRole] = useState<Role | null>(null)
    const [roleWithTemplate, setRoleWithTemplate] = useState<TemplateType[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null)
    const { user } = useUser()
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
        if (selectedRole) {
            setRoleWithTemplate(templates.filter((template) => template.role === selectedRole?.id))
        } else {
            setRoleWithTemplate([])
        }
        setSelectedTemplate(null) // Reset template when role changes
    }, [templates, selectedRole])

    const submitHandler = () => {
        try {
            if (formDetails.company.trim().length === 0 || formDetails.recruiterName.trim().length === 0) {
                toast.error("Company and Recruiter Name are required")
                return
            }
            if (!selectedTemplate) {
                toast.error("Template is required")
                return
            }
            let myName = user?.firstName || ""
            if (user?.lastName) {
                myName = myName + " " + user?.lastName
            }

            let newMessage = selectedTemplate.content
            // Use global replace (/g flag) to replace ALL occurrences
            newMessage = newMessage.replace(/\[Recruiter Name\]/g, capitalizeWords(formDetails.recruiterName))
            newMessage = newMessage.replace(/\[Company Name\]/g, capitalizeWords(formDetails.company))
            newMessage = newMessage.replace(/\[Role\]/g, capitalizeWords(selectedTemplate.roleRelation.name))
            newMessage = newMessage.replace(/\[MY NAME\]/g, capitalizeWords(myName))

            console.log("Generated message:", newMessage)

            navigator.clipboard.writeText(newMessage)
            toast.success("Message copied.")
        } catch (error) {
            toast.error("Something went wrong")
            console.log(error)
        }
    }

    return (
        <div className='  w-full h-screen flex justify-center items-center'>

            {/* {openSearch && <ModalContainer setOpen={setOpenSearch} />} */}

            <Card className=' min-w-[90%]  md:min-w-[70%] lg:min-w-[40%] h-fit '>
                <CardHeader>
                    <CardTitle className=' text-2xl font-semibold'>Generate Message</CardTitle>
                    {/* <CardDescription>Card Description</CardDescription> */}
                    {/* <CardAction>Card Action</CardAction>  */}
                </CardHeader>
                <CardContent>
                    <div className="mb-4 flex flex-col gap-2">
                        <Label htmlFor="email">Recruiter Name</Label>
                        <Input value={formDetails.recruiterName} onChange={(e) => setFormDetails({ ...formDetails, recruiterName: e.target.value })} id="email" placeholder="Jhon Doe...." type="text" />
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
                                        console.log("Selected template:", template)
                                    }
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={selectedRole ? "Select Template" : "Select Role First"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {roleWithTemplate.map((template) => (
                                        <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>


                    <div className="mb-4 flex flex-col gap-2">
                        <Label htmlFor="email">Company Name</Label>
                        <Input value={formDetails.company} onChange={(e) => setFormDetails({ ...formDetails, company: e.target.value })} id="email" placeholder="Company Name...." type="text" />
                    </div>


                    <div className="flex flex-col gap-2">

                        <div className=' w-[47%]  gap-2'>
                            {selectedTemplate && selectedTemplate.rules.find(rule => rule.rule === "[GENDER]") && <RadioGroup className=' flex ' defaultValue="male">
                                {/* preselect male */}
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="male" id="male" onChange={() => setFormDetails({ ...formDetails, isMale: true })} />
                                    <Label htmlFor="option-one">Male</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="female" id="female" onChange={() => setFormDetails({ ...formDetails, isMale: false })} />
                                    <Label htmlFor="option-two">Female</Label>
                                </div>
                            </RadioGroup>}
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
