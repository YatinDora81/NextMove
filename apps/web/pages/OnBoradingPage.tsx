"use client"
import React, { useEffect, useState } from 'react'
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Progress } from '@/components/ui/progress'

import { Input } from '@/components/ui/input'
import { Label } from '@radix-ui/react-label'
import { Button } from '@/components/ui/button'
import { useAuth, useUser } from '@clerk/nextjs'

function OnBoradingPage() {

    const steps = [
        {
            heading: "👋 Begin your journey",
            description: "Start by confirming your full name.",
            footer: "Don’t worry, you can always edit this later in your profile."
        }
    ];
    const [currStep, setCurrStep] = useState(0);
    const { user } = useUser()
    const [fullName, setFullName] = useState("");

    useEffect(() => {
        setFullName(user?.fullName || "");
    }, [user])


    return (
        <div className=' w-full h-screen flex justify-center items-center flex-col'>
            <div className=' min-w-[90%]  md:min-w-[70%] lg:min-w-[40%]  h-[70vh] flex justify-start items-center gap-6 flex-col '>
                <Progress value={(currStep + 1) * 100 / steps.length}></Progress>
                <Card className=' w-full '>
                    <CardHeader>
                        <CardTitle className=' text-2xl'>{steps[currStep]?.heading}</CardTitle>
                        <CardDescription className=' text-sm'>{steps[currStep]?.description}</CardDescription>
                    </CardHeader>
                    {
                        currStep === 0 && <CardContent className=' flex  flex-col  gap-3'>

                            <div className="mb-4 flex flex-col gap-2">
                                <Label htmlFor="email">Full Name</Label>
                                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} id="email" placeholder="Jhon Doe...." type="text" />
                            </div>

                            <div className=' w-full flex justify-end'>
                                <Button className=''>{user?.fullName === fullName ? "Skip" : "Next"}</Button>
                            </div>

                        </CardContent>
                    }

                    {
                        currStep === 1 && <CardContent className=' flex  flex-col  gap-3'>

                        </CardContent>
                    }

                    <CardFooter className='flex justify-between items-center text-sm text-muted-foreground px-6 pb-4'>
                        <p className='italic'>{steps[currStep]?.footer}</p>
                        <p>Step {currStep + 1} of {steps.length}</p>
                    </CardFooter>
                </Card>
            </div>
        </div>
    )
}

export default OnBoradingPage
