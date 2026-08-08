"use client"

import { useState } from "react"
import type { EducationEntry, SharedProfile, WorkEntry } from "@repo/types/ProfileTypes"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    AddEntryButton,
    EmptyRepeaterState,
    RepeaterCard,
    StepHeader,
    SubSection,
    TextField,
    moveItem,
    type StepProps,
} from "@/app/onboarding/steps/fields"

const EMPTY_WORK: WorkEntry = {
    title: "",
    company: "",
    location: "",
    start: "",
    end: "",
    current: false,
    bullets: [],
}

const EMPTY_EDUCATION: EducationEntry = {
    school: "",
    degree: "",
    field: "",
    start: "",
    end: "",
    gpa: "",
}

const MONTH_HINT = "Month and year"

export function ExperienceStep({ draft, patch }: StepProps) {
    const [openWork, setOpenWork] = useState<number | null>(draft.work.length === 0 ? null : 0)
    const [openEducation, setOpenEducation] = useState<number | null>(null)

    const setWork = (work: WorkEntry[]) => patch({ work } satisfies Partial<SharedProfile>)
    const setEducation = (education: EducationEntry[]) =>
        patch({ education } satisfies Partial<SharedProfile>)

    const updateWork = (index: number, next: Partial<WorkEntry>) => {
        setWork(draft.work.map((entry, i) => (i === index ? { ...entry, ...next } : entry)))
    }

    const updateEducation = (index: number, next: Partial<EducationEntry>) => {
        setEducation(draft.education.map((entry, i) => (i === index ? { ...entry, ...next } : entry)))
    }

    const followMove = (open: number | null, index: number, delta: number): number | null => {
        if (open === index) return index + delta
        if (open === index + delta) return index
        return open
    }

    return (
        <div className="flex flex-col gap-8">
            <StepHeader
                title="Experience"
                description="Your work history and education, most recent first. Add as much or as little as you like — every field here is optional, and you can edit all of it later."
            />

            <SubSection
                title="Work history"
                hint="The bullets become the “describe your responsibilities” answers the extension offers."
            >
                {draft.work.length === 0 ? (
                    <EmptyRepeaterState
                        title="No roles yet"
                        body="Add your most recent role first. Even a single entry gives the extension something to work with."
                    />
                ) : (
                    <ul className="flex flex-col gap-2">
                        {draft.work.map((entry, index) => (
                            <RepeaterCard
                                key={`work-${index}`}
                                title={entry.title.trim() || "Untitled role"}
                                subtitle={
                                    [entry.company.trim(), entry.current ? "Current" : entry.end?.trim()]
                                        .filter((part) => part)
                                        .join(" · ") || "No company yet"
                                }
                                open={openWork === index}
                                onToggle={() => setOpenWork(openWork === index ? null : index)}
                                onMoveUp={
                                    index > 0
                                        ? () => {
                                              setWork(moveItem(draft.work, index, -1))
                                              setOpenWork(followMove(openWork, index, -1))
                                          }
                                        : undefined
                                }
                                onMoveDown={
                                    index < draft.work.length - 1
                                        ? () => {
                                              setWork(moveItem(draft.work, index, 1))
                                              setOpenWork(followMove(openWork, index, 1))
                                          }
                                        : undefined
                                }
                                onRemove={() => {
                                    setWork(draft.work.filter((_, i) => i !== index))
                                    setOpenWork(null)
                                }}
                                removeLabel={`Remove ${entry.title.trim() || "this role"}`}
                            >
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextField
                                        label="Job title"
                                        value={entry.title}
                                        placeholder="Senior Frontend Engineer"
                                        onChange={(value) => updateWork(index, { title: value })}
                                    />
                                    <TextField
                                        label="Company"
                                        value={entry.company}
                                        placeholder="Acme Corp"
                                        onChange={(value) => updateWork(index, { company: value })}
                                    />
                                    <TextField
                                        label="Location"
                                        value={entry.location}
                                        placeholder="Berlin, Germany — or Remote"
                                        className="sm:col-span-2"
                                        onChange={(value) => updateWork(index, { location: value })}
                                    />
                                    <TextField
                                        label="Started"
                                        type="month"
                                        hint={MONTH_HINT}
                                        value={entry.start}
                                        onChange={(value) => updateWork(index, { start: value })}
                                    />
                                    <TextField
                                        label="Ended"
                                        type="month"
                                        hint={entry.current ? "Currently in this role" : MONTH_HINT}
                                        value={entry.end ?? ""}
                                        disabled={entry.current}
                                        onChange={(value) => updateWork(index, { end: value })}
                                    />
                                </div>

                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={entry.current}
                                        onCheckedChange={(checked) => {
                                            const current = checked === true
                                            updateWork(index, { current, end: current ? null : "" })
                                        }}
                                    />
                                    I still work here
                                </label>

                                <div className="flex flex-col gap-2">
                                    <Label htmlFor={`work-bullets-${index}`}>What you did</Label>
                                    <Textarea
                                        id={`work-bullets-${index}`}
                                        rows={4}
                                        value={entry.bullets.join("\n")}
                                        placeholder={"One line per bullet:\nCut checkout latency by 40%\nLed a team of four"}
                                        onChange={(event) =>
                                            updateWork(index, { bullets: event.target.value.split("\n") })
                                        }
                                        onBlur={() =>
                                            updateWork(index, {
                                                bullets: entry.bullets.filter((line) => line.trim() !== ""),
                                            })
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">One bullet per line.</p>
                                </div>
                            </RepeaterCard>
                        ))}
                    </ul>
                )}

                <AddEntryButton
                    label="Add a role"
                    onClick={() => {
                        setWork([...draft.work, { ...EMPTY_WORK, bullets: [] }])
                        setOpenWork(draft.work.length)
                    }}
                />
            </SubSection>

            <SubSection title="Education" hint="Schools, bootcamps, certifications — whatever a form is likely to ask about.">
                {draft.education.length === 0 ? (
                    <EmptyRepeaterState
                        title="No education yet"
                        body="Skip this if it isn’t relevant to the roles you’re applying for."
                    />
                ) : (
                    <ul className="flex flex-col gap-2">
                        {draft.education.map((entry, index) => (
                            <RepeaterCard
                                key={`education-${index}`}
                                title={entry.school.trim() || "Untitled school"}
                                subtitle={
                                    [entry.degree.trim(), entry.field.trim()]
                                        .filter((part) => part)
                                        .join(" · ") || "No degree yet"
                                }
                                open={openEducation === index}
                                onToggle={() => setOpenEducation(openEducation === index ? null : index)}
                                onMoveUp={
                                    index > 0
                                        ? () => {
                                              setEducation(moveItem(draft.education, index, -1))
                                              setOpenEducation(followMove(openEducation, index, -1))
                                          }
                                        : undefined
                                }
                                onMoveDown={
                                    index < draft.education.length - 1
                                        ? () => {
                                              setEducation(moveItem(draft.education, index, 1))
                                              setOpenEducation(followMove(openEducation, index, 1))
                                          }
                                        : undefined
                                }
                                onRemove={() => {
                                    setEducation(draft.education.filter((_, i) => i !== index))
                                    setOpenEducation(null)
                                }}
                                removeLabel={`Remove ${entry.school.trim() || "this entry"}`}
                            >
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextField
                                        label="School"
                                        value={entry.school}
                                        placeholder="Technical University of Munich"
                                        className="sm:col-span-2"
                                        onChange={(value) => updateEducation(index, { school: value })}
                                    />
                                    <TextField
                                        label="Degree"
                                        value={entry.degree}
                                        placeholder="BSc"
                                        onChange={(value) => updateEducation(index, { degree: value })}
                                    />
                                    <TextField
                                        label="Field of study"
                                        value={entry.field}
                                        placeholder="Computer Science"
                                        onChange={(value) => updateEducation(index, { field: value })}
                                    />
                                    <TextField
                                        label="Started"
                                        type="month"
                                        hint={MONTH_HINT}
                                        value={entry.start}
                                        onChange={(value) => updateEducation(index, { start: value })}
                                    />
                                    <TextField
                                        label="Finished"
                                        type="month"
                                        hint={MONTH_HINT}
                                        value={entry.end ?? ""}
                                        onChange={(value) => updateEducation(index, { end: value })}
                                    />
                                    <TextField
                                        label="Grade"
                                        value={entry.gpa}
                                        placeholder="3.8 / 4.0 — or 2:1"
                                        hint="Leave blank if you would rather not say."
                                        className="sm:col-span-2"
                                        onChange={(value) => updateEducation(index, { gpa: value })}
                                    />
                                </div>
                            </RepeaterCard>
                        ))}
                    </ul>
                )}

                <AddEntryButton
                    label="Add education"
                    onClick={() => {
                        setEducation([...draft.education, { ...EMPTY_EDUCATION }])
                        setOpenEducation(draft.education.length)
                    }}
                />
            </SubSection>
        </div>
    )
}
