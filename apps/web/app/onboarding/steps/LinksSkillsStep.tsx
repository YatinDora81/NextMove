"use client"

import { Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/quiet/Button"
import { Input, Textarea } from "@/components/quiet/Field"
import {
    AddEntryButton,
    ChipInput,
    StepHeader,
    SubSection,
    TextField,
    labelClass,
    type StepProps,
} from "@/app/onboarding/steps/fields"

type NamedLink = "linkedin" | "github" | "portfolio"

function normaliseUrl(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed === "") return ""
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^[^\s/]+\.[^\s/]{2,}/.test(trimmed)) return `https://${trimmed}`
    return trimmed
}

const SUMMARY_LIMIT = 600

export function LinksSkillsStep({ draft, errors, patch, onBlurField }: StepProps) {
    const { links } = draft

    const setLinks = (next: Partial<typeof links>) => patch({ links: { ...links, ...next } })

    const handleLinkBlur = (key: NamedLink) => {
        const normalised = normaliseUrl(links[key])
        if (normalised !== links[key]) {
            const next = { ...links }
            next[key] = normalised
            patch({ links: next })
        }
        onBlurField(`links.${key}`, normalised)
    }

    const setOther = (index: number, value: string) => {
        setLinks({ other: links.other.map((item, i) => (i === index ? value : item)) })
    }

    return (
        <div className="flex flex-col gap-6">
            <StepHeader
                title="Links & skills"
                description="The profile links recruiters ask for by name, plus the keyword list that answers “what technologies have you used?”."
            />

            <SubSection title="Profiles" hint="Paste them however you have them — we tidy the format for you.">
                <div className="grid gap-4">
                    <TextField
                        label="LinkedIn"
                        type="url"
                        inputMode="url"
                        placeholder="linkedin.com/in/your-name"
                        value={links.linkedin}
                        error={errors["links.linkedin"]}
                        onChange={(value) => setLinks({ linkedin: value })}
                        onBlur={() => handleLinkBlur("linkedin")}
                    />
                    <TextField
                        label="GitHub"
                        type="url"
                        inputMode="url"
                        placeholder="github.com/your-handle"
                        value={links.github}
                        error={errors["links.github"]}
                        onChange={(value) => setLinks({ github: value })}
                        onBlur={() => handleLinkBlur("github")}
                    />
                    <TextField
                        label="Portfolio or personal site"
                        type="url"
                        inputMode="url"
                        placeholder="your-name.dev"
                        value={links.portfolio}
                        error={errors["links.portfolio"]}
                        onChange={(value) => setLinks({ portfolio: value })}
                        onBlur={() => handleLinkBlur("portfolio")}
                    />
                </div>

                {links.other.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                        {links.other.map((value, index) => (
                            <li key={`other-link-${index}`} className="flex items-end gap-2">
                                <div className="flex flex-1 flex-col gap-1.5">
                                    <Label htmlFor={`other-link-input-${index}`} className={labelClass}>
                                        Other link {index + 1}
                                    </Label>
                                    <Input
                                        id={`other-link-input-${index}`}
                                        type="url"
                                        inputMode="url"
                                        placeholder="dribbble.com/you, a published paper, a talk…"
                                        value={value}
                                        onChange={(event) => setOther(index, event.target.value)}
                                        onBlur={() => setOther(index, normaliseUrl(value))}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-label={`Remove other link ${index + 1}`}
                                    className="size-9 shrink-0 p-0 hover:bg-danbg hover:text-dan"
                                    onClick={() =>
                                        setLinks({ other: links.other.filter((_, i) => i !== index) })
                                    }
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : null}

                <AddEntryButton
                    label="Add another link"
                    onClick={() => setLinks({ other: [...links.other, ""] })}
                />
            </SubSection>

            <SubSection
                title="Skills"
                hint="Type a skill and press Enter. Pasting a comma-separated list splits it into chips."
            >
                <ChipInput
                    label="Your skills"
                    values={draft.skills}
                    placeholder="TypeScript, Postgres, Figma…"
                    onChange={(skills) => patch({ skills })}
                />

                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="profile-summary" className={labelClass}>
                        Short summary
                    </Label>
                    <Textarea
                        id="profile-summary"
                        rows={3}
                        maxLength={SUMMARY_LIMIT}
                        placeholder="Two or three sentences on what you do and what you’re looking for."
                        value={draft.summary ?? ""}
                        onChange={(event) => patch({ summary: event.target.value })}
                    />
                    <p className="text-xs leading-relaxed text-fg2">
                        Optional. Forms with a “tell us about yourself” box get this, and NextMove’s AI
                        uses it as context when it drafts an answer.
                    </p>
                </div>
            </SubSection>
        </div>
    )
}
