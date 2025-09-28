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
import { useAuth } from '@clerk/nextjs'
import toast from 'react-hot-toast'

function GeneratePromt() {

    const toastOpt = {
        style: {
            borderRadius: '10px',
            background: '#333',
            color: '#fff',
        },
    }

    const [currRole, setCurrRole] = useState<any>(null);
    const [compDet, setCompDet] = useState<{
        cName: string,
        rName: string,
        isMale: boolean,
    }>({
        cName: "",
        rName: "",
        isMale: true,
    });


    const roles = [
        {
            role: "Front End",
            promt: `Hi [Recruiter Name],

I hope you're doing well. I’m Yatin Dora, a final-year B.E. Computer Science student from Chitkara University.

I have experience in full-stack development, building both frontend and backend for scalable web applications. At my current company, I contributed to modern web platforms using Next.js, Node.js, TypeScript, and MySQL, ensuring robust and maintainable systems. At my previous company, I focused on frontend development and implemented automated test cases with Selenium and Jest, significantly enhancing test coverage and overall platform reliability.

I’m proficient in frontend development, with expertise in React.js, Next.js, TypeScript, Tailwind CSS, and modern state management solutions like Redux and Zustand. My recent projects include a collaborative drawing platform and a real-time chat app, where I built responsive and interactive user interfaces, optimized performance, and ensured smooth user experiences.

I’m actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I’ve attached my resume for your reference. Please let me know if you'd need any additional information.

Best regards,
Yatin Dora`,
            isMale: true,
        },
        {
            role: "Backend End",
            promt: `Hi [Recruiter Name],

I hope you're doing well. I’m Yatin Dora, a final-year B.E. Computer Science student from Chitkara University.

I have experience in full-stack development, building both frontend and backend for scalable web applications. At my current company, I contributed to modern web platforms using Next.js, Node.js, TypeScript, and MySQL, ensuring robust and maintainable systems. At my previous company, I focused on frontend development and implemented automated test cases with Selenium and Jest, significantly enhancing test coverage and overall platform reliability.

I’m proficient in backend development, with expertise in Node.js, Express.js, Prisma, Drizzle ORM, and Docker. My recent projects include a collaborative drawing platform and a real-time chat app, where I designed and implemented REST and WebSocket APIs, optimized database schemas, and ensured scalable, maintainable server-side systems.

I’m actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I’ve attached my resume for your reference. Please let me know if you'd need any additional information.

Best regards,
Yatin Dora`,
            isMale: true,
        },
        {
            role: "Full Stack",
            promt: `Hi [Recruiter Name],

I hope you're doing well. I’m Yatin Dora, a final-year B.E. Computer Science student from Chitkara University.

I have experience as a full-stack development intern, building both frontend and backend for scalable web applications. During my internship at Wiingy, I contributed to modern web platforms using Next.js, Node.js, TypeScript, and MySQL, ensuring robust and maintainable systems. At my previous internship with Nykaa, I focused on frontend development and implemented automated test cases with Selenium and Jest, significantly improving test coverage and platform reliability.

I’m proficient in the MERN stack and experienced with backend tools like Prisma, Drizzle ORM, Docker, and Express.js. My recent projects include a collaborative drawing platform and a real-time chat app built with Next.js, Node.js, and WebSocket, showcasing both frontend and backend development skills, as well as modern development practices using Git, Turborepo, and CI/CD workflows.

I’m actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I’ve attached my resume for your reference. Please let me know if you'd need any additional information.

Best regards,
Yatin Dora`,
            isMale: true,
        }
    ]

    const submitHandler = () => {
        if (compDet.cName.trim().length === 0 || compDet.rName.trim().length === 0 || currRole === null || !roles) {
            toast.error("Please fill all the fields", toastOpt)
            return
        }

        const promt = currRole.promt.replace("[Recruiter Name]", compDet.rName.toUpperCase()).replace("[Company Name]", compDet.cName.toUpperCase()).replace("[Role]", currRole.role?.toUpperCase())
        navigator.clipboard.writeText(promt)
        toast.success("Copied", toastOpt)

        

    }


    return (
        <div className=' w-full h-screen flex justify-center items-center'>
            <Card className=' min-w-[90%]  md:min-w-[70%] lg:min-w-[40%] h-fit '>
                <CardHeader>
                    <CardTitle className=' text-2xl font-semibold'>Generate Message</CardTitle>
                    {/* <CardDescription>Card Description</CardDescription> */}
                    {/* <CardAction>Card Action</CardAction>  */}
                </CardHeader>
                <CardContent>
                    <div className="mb-4 flex flex-col gap-2">
                        <Label htmlFor="email">Recruiter Name</Label>
                        <Input value={compDet.rName} onChange={(e) => setCompDet({ ...compDet, rName: e.target.value })} id="email" placeholder="Jhon Doe...." type="text" />
                    </div>


                    <div className="mb-4 flex  justify-between gap-2">
                        <div className=' w-[47%]'>
                            <Label htmlFor="roles">Role</Label>
                            <Select>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Roles" />
                                </SelectTrigger>
                                <SelectContent>
                                    {
                                        roles.map((r, i) => <SelectItem onClick={() => setCurrRole(r)} key={i} value={r.role}>{r.role}</SelectItem>)
                                    }
                                </SelectContent>
                            </Select>
                        </div>
                        <div className=' w-[47%]'>
                            <Label htmlFor="roles">Template</Label>
                            <Select>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select Template" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="light">Template 1</SelectItem>
                                    <SelectItem value="dark">Template 2</SelectItem>
                                    <SelectItem value="system">Template 3</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>


                    <div className="mb-4 flex flex-col gap-2">
                        <Label htmlFor="email">Company Name</Label>
                        <Input value={compDet.cName} onChange={(e) => setCompDet({ ...compDet, cName: e.target.value })} id="email" placeholder="Company Name...." type="text" />
                    </div>


                    <div className="flex flex-col gap-2">

                        <div className=' w-[47%]  gap-2'>
                            <RadioGroup className=' flex ' defaultValue={compDet.isMale ? "male" : "female"}>
                                {/* preselect male */}
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="male" id="male" onClick={() => setCompDet({ ...compDet, isMale: true })} />
                                    <Label htmlFor="option-one">Male</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="female" id="female" onClick={() => setCompDet({ ...compDet, isMale: false })} />
                                    <Label htmlFor="option-two">Female</Label>
                                </div>
                            </RadioGroup>
                        </div>


                        <div>
                            <RadioGroup defaultValue="message" className=' flex'>
                                {/* preselect message */}
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="message" id="message" />
                                    <Label htmlFor="message">Simple Message</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="email" id="email" />
                                    <Label htmlFor="email">Email Format</Label>
                                </div>
                            </RadioGroup>
                        </div>

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
