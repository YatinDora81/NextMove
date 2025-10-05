"use client"
import React, { ReactNode } from 'react'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from '../ui/textarea'
import { Switch } from "@/components/ui/switch"
import { Button } from '../ui/button'

function TemplateOpeartion({ children, isUpdate = false, currData = null }: { children: ReactNode, isUpdate?: boolean, currData?: any }) {

    const rules = [
        {
            name: "[Recruiter Name]",
            defaultValue: true
        },
        {
            name: "[Company Name]",
            defaultValue: true
        },
        {
            name: "[Gender]",
            defaultValue: false
        }
    ]

    return (
        <Dialog >
            <DialogTrigger>{children}</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{!isUpdate ? 'Create New Template' : 'Update Template'}</DialogTitle>
                    <DialogDescription>


                        <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                            <Label htmlFor="name">Template Name</Label>
                            <Input id="name" placeholder="For CEO of Company" type='text' />
                        </div>

                        <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                            <Label htmlFor="tempp">Template Description</Label>
                            <Textarea  id="tempp" placeholder="Hi [Recruiter Name] i want to join your [Company]"  className=' resize-none h-[25vh]  overflow-y-auto' />
                        </div>

                        <div className=' w-full flex items-center justify-between'>
                            <div className=' w-[47%] flex flex-col gap-1'>
                                <Label htmlFor="roles ">Role</Label>
                                <Select defaultValue='Full Stack'>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Roles" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Frontend">Frontend</SelectItem>
                                        <SelectItem value="Backend">Backend</SelectItem>
                                        <SelectItem value="Full Stack">Full Stack</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className=' w-[47%] flex flex-col gap-1'>
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
                            </div>

                        </div>


                        <div className="my-4 flex flex-col items-start gap-2 overflow-auto">
                            <div>Rules</div>
                            {
                                rules.map((r, i) => <div key={i} className=' flex  justify-start items-start  gap-2'>
                                    <Switch id='rule-1' defaultChecked={r.defaultValue}></Switch>
                                    <Label htmlFor='rule-1'>{r.name}</Label>
                                </div>)
                            }
                        </div>

                        <div className='flex w-full justify-evenly items-center'>
                            {isUpdate && <Button className='w-[48%] hover:text-red-500 ' variant={'outline'}>Cancel</Button>}
                            <Button className={`${isUpdate ? 'w-[48%] ' : 'w-full'}`}>Generate Template</Button>
                        </div>


                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    )
}

export default TemplateOpeartion
