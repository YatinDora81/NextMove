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
import { useTemplates } from '@/hooks/useTemplates'
import { Role, TemplateType } from '@/utils/api_types'
import { toTitleCase } from '@/utils/strings'
import toast from 'react-hot-toast'



function TemplatesPage({ allRoles }: { allRoles: Role[] }) {

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
    const { templates: orignalTemplates, deleteTemplate } = useTemplates()
    const [renderTemplates, setRenderTemplates] = useState<TemplateType[]>([]);

    useEffect(() => {
        setRenderTemplates(orignalTemplates)
    }, [orignalTemplates])

    console.log('renderTemplates', renderTemplates)


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

                        <TemplateOpeartion allRoles={allRoles} isUpdate={false} currData={null}>
                            <Button variant={"default"} className=' flex justify-center items-center gap-2 ' >
                                <Plus />New
                            </Button>
                        </TemplateOpeartion>

                    </div>
                </div>

                <Accordion type="single" collapsible className=' w-full'>

                    {
                        renderTemplates.map((template) => (<AccordionItem key={template?.id} value={template?.id} className=' w-full bzinc-100 dark:bzinc-900/40 rounded-xl  px-5 md:px-10 '>
                            <AccordionTrigger>

                                <div className=' flex flex-col gap-3 pb-2 '>
                                    <div className=' flex gap-2'>
                                        <div className=' bgray-700/10 dark:bzinc-950 px-3 border flex justify-center items-center  py-2 rounded-2xl'>{toTitleCase(template.type)}</div>
                                        <div className=' bgray-700/10 dark:bzinc-950  px-3 border flex justify-center items-center  py-2 rounded-2xl'>{template.roleRelation ? toTitleCase(template.roleRelation.name) : 'N/A'}</div>
                                    </div>
                                    {/* <div className=' px-3'>For Mutuals</div> */}
                                    <div className=' text-lg  pl-2'>{template.name}</div>
                                </div>

                            </AccordionTrigger>
                            <AccordionContent className=' w-full flex justify-between items-start gap-2'>
                                <div className='pl-2 w-full text-black dark:text-zinc-300 whitespace-pre-line'>
                                    {template.content}
                                </div>
                                <div className=' flex gap-1 '>
                                    <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={'sm'} onClick={() => { navigator.clipboard.writeText(template.content); toast.success('Copied to clipboard') }} > <Copy /></Button>
                                    <TemplateOpeartion allRoles={allRoles} isUpdate={true} currData={template}>
                                        <Button variant={"outline"} className=' flex justify-center items-center gap-2 ' size={"sm"} > <Edit /></Button>
                                    </ TemplateOpeartion>
                                    <AlertModal alertMode={1} onConfirm={() => deleteTemplate(template.id)}>
                                        <Button variant={"outline"} className=' flex justify-center items-center gap-2 hover:text-red-500 ' size={"sm"} > <Trash /></Button>
                                    </AlertModal>
                                </div>

                            </AccordionContent>
                        </AccordionItem>))
                    }

                </Accordion>


            </div>

        </div >
    )
}

export default TemplatesPage
