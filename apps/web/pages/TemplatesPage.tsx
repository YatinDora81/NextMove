"use client"
import React, { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from '@/components/ui/button'
import { Copy, Edit, Plus, Trash } from 'lucide-react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import TemplateOpeartion from '@/components/modals/TemplateOpeartion'
import AlertModal from '@/components/modals/AlertModal'



function TemplatesPage() {

    const filters = [
        {
            name: 'All',
        },
        {
            name: 'Email',
        },
        {
            name: 'Message'
        }
    ]

    const [filter, setFilter] = useState('All')
    const [orignalTemplates, setOriginalTemplates] = useState<any>([]);
    const [renderTemplates, setRenderTemplates] = useState<any>([]);

    useEffect(() => {
        setRenderTemplates(orignalTemplates)
    }, [orignalTemplates])


    return (
        <div className=' w-full pt-[8vh] md:pt-[12vh]  min-h-screen  flex items-start justify-center'>
            <div className=' w-[90%] gap-5 flex flex-col justify-start items-start'>

                <div className=' w-full flex justify-between items-center'>
                    <div className=' flex flex-col gap-4'>
                        <h1 className=' text-3xl font-mono font-semibold'>Templates</h1>

                        <Tabs defaultValue="All" >
                            <TabsList className=' dark:bzinc-900'>
                                {filters.map((f, i) => (
                                    <TabsTrigger key={i} value={f.name} onClick={() => setFilter(f.name)} className=' font-mono'>{f.name}</TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>

                    <div>

                        <TemplateOpeartion isUpdate={false} currData={null}>
                            <Button variant={"default"} className=' flex justify-center items-center gap-2 ' >
                                <Plus />New
                            </Button>
                        </TemplateOpeartion>

                    </div>
                </div>

                <Accordion type="single" collapsible className=' w-full'>

                    <AccordionItem value="item-1" className=' w-full bzinc-100 dark:bzinc-900/40 rounded-xl  px-5 md:px-10 '>
                        <AccordionTrigger>

                            <div className=' flex flex-col gap-2 pb-2 '>
                                <div className=' flex'>
                                    <div className=' bgray-700/10 dark:bzinc-950 w-[82px] border flex justify-center items-center  py-2 rounded-2xl'>Message</div>
                                    <div className=' bgray-700/10 dark:bzinc-950 w-[82px] border flex justify-center items-center  py-2 rounded-2xl'>Full Stack</div>
                                </div>
                                {/* <div className=' px-3'>For Mutuals</div> */}
                                <div className=' text-lg  pl-2'>A special thanks for </div>
                            </div>

                        </AccordionTrigger>
                        <AccordionContent className=' w-full flex justify-between items-start gap-2'>
                            <div className='pl-2 w-full text-black dark:text-zinc-300'>
                                {"okayyy cyt vuvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvhhhhhhhhhhhhhhhhhhhhhhhh hhhhhhhhhhhhhhhhhhhhh h hhhhhhhhhhhhhhhhhhhb ctfvy guh fctvgbhj fc vghbj cfvgbh cyvg hu vbhu vguhvub vyguh gvyuh ivugbh".split("\n").map((line, idx) => (
                                    <p key={idx}>{line}</p>
                                ))}
                            </div>
                            <div className=' flex gap-1 '>
                                <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={'sm'} > <Copy /></Button>
                                <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={"sm"} > <Edit /></Button>
                                <AlertModal alertMode={1} >
                                    <Button variant={"outline"} className=' flex justify-center items-center gap-2 hover:text-red-500 ' size={"sm"} > <Trash /></Button>
                                </AlertModal>
                            </div>

                        </AccordionContent>
                    </AccordionItem>





                    <AccordionItem value="item-2" className=' w-full bzinc-900/40 rounded-xl  px-5 md:px-10 '>
                        <AccordionTrigger>

                            <div className=' flex flex-col gap-2 pb-2 '>
                                <div className=' flex'>
                                    <div className=' bzinc-950 w-[82px] border flex justify-center items-center  py-2 rounded-2xl'>Email</div>
                                    <div className=' bzinc-950 w-[82px] border flex justify-center items-center  py-2 rounded-2xl'>FrontEnd</div>
                                </div>
                                {/* <div className=' px-3'>For Mutuals</div> */}
                                <div className=' text-lg  pl-2'>A special thanks for </div>
                            </div>

                        </AccordionTrigger>
                        <AccordionContent className=' w-full flex justify-between items-start gap-2'>
                            <div className='pl-2 w-full text-zinc-300'>
                                {"okayyy cyt vuvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvhhhhhhhhhhhhhhhhhhhhhhhh hhhhhhhhhhhhhhhhhhhhh h hhhhhhhhhhhhhhhhhhhb ctfvy guh fctvgbhj fc vghbj cfvgbh cyvg hu vbhu vguhvub vyguh gvyuh ivugbh".split("\n").map((line, idx) => (
                                    <p key={idx}>{line}</p>
                                ))}
                            </div>
                            <div className=' flex gap-1 '>
                                <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={'sm'} > <Copy /></Button>
                                <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={"sm"} > <Edit /></Button>
                                <AlertModal alertMode={1} >
                                    <Button variant={"outline"} className=' flex justify-center items-center gap-2 hover:text-red-500 ' size={"sm"} > <Trash /></Button>
                                </AlertModal>
                            </div>

                        </AccordionContent>
                    </AccordionItem>




                </Accordion>


            </div>

        </div >
    )
}

export default TemplatesPage
