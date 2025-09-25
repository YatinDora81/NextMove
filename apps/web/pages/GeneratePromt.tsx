"use client"
import React from 'react'
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

function GeneratePromt() {
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
                        <Input id="email" placeholder="Jhon Doe...." type="text" />
                    </div>


                    <div className="mb-4 flex  justify-between gap-2">
                        <div className=' w-[47%]'>
                            <Label htmlFor="roles">Role</Label>
                            <Select>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Roles" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="light">Frontend</SelectItem>
                                    <SelectItem value="dark">Backend</SelectItem>
                                    <SelectItem value="system">Full Stack</SelectItem>
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
                        <Input id="email" placeholder="Company Name...." type="text" />
                    </div>


                    <div className="flex flex-col gap-2">

                        <div className=' w-[47%]  gap-2'>
                            <RadioGroup className=' flex ' defaultValue="male">
                                {/* preselect male */}
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="male" id="male" />
                                    <Label htmlFor="option-one">Male</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="female" id="female" />
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
                    <Button className=' w-full'>Generate Message</Button>
                </CardFooter>
            </Card>
        </div>
    )
}

export default GeneratePromt
