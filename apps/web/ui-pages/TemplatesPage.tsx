"use client"
import { useEffect, useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Copy, Edit, Plus, Trash, FileText } from "lucide-react"
import TemplateOpeartion from "@/components/modals/TemplateOpeartion"
import AlertModal from "@/components/modals/AlertModal"
import { Button } from "@/components/quiet/Button"
import { Card } from "@/components/quiet/Card"
import { useTemplates } from "@/hooks/useTemplates"
import { Role, TemplateType } from "@/utils/api_types"
import { toTitleCase } from "@/utils/strings"
import toast from "react-hot-toast"

const tabTrigger =
    "h-auto flex-none rounded-[7px] border-transparent px-3 py-1.5 text-[13px] font-medium text-fg2 data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-qsm dark:text-fg2 dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-surface dark:data-[state=active]:text-fg"

function TemplatesPage({ allRoles }: { allRoles: Role[] }) {

    const filters = [
        {
            name: "All",
        },
        {
            name: "Message",
        },
        {
            name: "Email"
        }
    ]

    const [, setFilter] = useState("All")
    const { templates: orignalTemplates, deleteTemplate, isTemplateLoading } = useTemplates()
    const [renderTemplates, setRenderTemplates] = useState<TemplateType[]>([]);

    useEffect(() => {
        setRenderTemplates(orignalTemplates)
    }, [orignalTemplates])

    return (
        <div className="min-h-screen w-full bg-bg text-fg">
            <div className="mx-auto w-full max-w-[980px] px-6 py-6">

                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-[22px] font-[650] tracking-[-0.02em] text-fg">Templates</h1>

                    <Tabs defaultValue="All">
                        <TabsList className="h-auto gap-0.5 rounded-[9px] bg-well p-[3px]">
                            {filters.map((f, i) => (
                                <TabsTrigger key={i} value={f.name} onClick={() => setFilter(f.name)} className={tabTrigger}>{f.name}</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>

                    <div className="ml-auto">
                        <TemplateOpeartion allRoles={allRoles} isUpdate={false} currData={null}>
                            <Button variant="acc" className="px-3 py-[7px] text-[13px]">
                                <Plus className="size-[13px]" strokeWidth={1.5} />New
                            </Button>
                        </TemplateOpeartion>
                    </div>
                </div>

                {renderTemplates.length === 0 && !isTemplateLoading ? (
                    <Card className="mt-4 flex w-full flex-col items-center justify-center px-6 py-12 text-center">
                        <FileText className="size-4 text-fg2" strokeWidth={1.5} />

                        <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.012em] text-fg">
                            No templates yet
                        </h3>
                        <p className="mt-1.5 max-w-sm text-[13px] leading-[1.6] text-fg2">
                            Create your first template to save time when reaching out to recruiters
                        </p>

                        <TemplateOpeartion allRoles={allRoles} isUpdate={false} currData={null}>
                            <Button variant="sec" className="mt-4 px-3 py-[7px] text-[13px]">
                                <Plus className="size-[13px]" strokeWidth={1.5} />
                                Create Template
                            </Button>
                        </TemplateOpeartion>
                    </Card>
                ) : (
                    <div className="mt-4 grid w-full gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                        {
                            renderTemplates.map((template) => (
                                <Card key={template?.id} className="flex min-h-[172px] flex-col p-4">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-sm font-semibold text-fg">{template.name}</span>
                                        <span className="text-xs text-fg2">{toTitleCase(template.type)}</span>
                                    </div>

                                    <p className="mt-2 line-clamp-4 flex-1 text-[12.5px] leading-[1.6] text-fg2">
                                        {template.content}
                                    </p>

                                    <div className="mt-2.5 flex items-center gap-1.5">
                                        <span className="text-xs text-fg2">{template.roleRelation ? toTitleCase(template.roleRelation.name) : "N/A"}</span>

                                        <Button variant="ghost" aria-label="Copy template" title="Copy template" className="ml-auto px-2 py-[5px]" onClick={() => { navigator.clipboard.writeText(template.content); toast.success("Copied to clipboard") }}>
                                            <Copy className="size-[13px]" strokeWidth={1.5} />
                                        </Button>

                                        <TemplateOpeartion allRoles={allRoles} isUpdate={true} currData={template}>
                                            <Button variant="ghost" aria-label="Edit template" title="Edit template" className="px-2 py-[5px]">
                                                <Edit className="size-[13px]" strokeWidth={1.5} />
                                            </Button>
                                        </ TemplateOpeartion>

                                        <AlertModal alertMode={1} onConfirm={() => deleteTemplate(template.id)}>
                                            <Button variant="danger" aria-label="Delete template" title="Delete template" className="px-2 py-[5px]">
                                                <Trash className="size-[13px]" strokeWidth={1.5} />
                                            </Button>
                                        </AlertModal>
                                    </div>
                                </Card>
                            ))
                        }
                    </div>
                )}

            </div>
        </div>
    )
}

export default TemplatesPage
