"use client"

/**
 * Step 4 — Links & skills.
 *
 * The three named links get normalised on blur: people paste "linkedin.com/in/name" far more often
 * than they paste a full URL, and rejecting that would be pedantry. We add the scheme, then
 * validate — so the error only ever fires on something genuinely unusable.
 */

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    AddEntryButton,
    ChipInput,
    StepHeader,
    SubSection,
    TextField,
    type StepProps,
} from "@/app/onboarding/steps/fields"

type NamedLink = "linkedin" | "github" | "portfolio"

/** "github.com/me" → "https://github.com/me". Anything already schemed, or clearly not a host, is left alone. */
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
        // Validate what we just wrote, not what the user typed — otherwise "github.com/me" would
        // be flagged in the same frame we fixed it.
        onBlurField(`links.${key}`, normalised)
    }

    const setOther = (index: number, value: string) => {
        setLinks({ other: links.other.map((item, i) => (i === index ? value : item)) })
    }

    return (
        <div className="flex flex-col gap-8">
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
                                <div className="flex flex-1 flex-col gap-2">
                                    <Label htmlFor={`other-link-input-${index}`}>
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
                                    size="icon"
                                    aria-label={`Remove other link ${index + 1}`}
                                    className="text-muted-foreground hover:text-destructive"
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

                <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-summary">Short summary</Label>
                    <Textarea
                        id="profile-summary"
                        rows={3}
                        maxLength={SUMMARY_LIMIT}
                        placeholder="Two or three sentences on what you do and what you’re looking for."
                        value={draft.summary ?? ""}
                        onChange={(event) => patch({ summary: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                        Optional. Forms with a “tell us about yourself” box get this, and NextMove’s AI
                        uses it as context when it drafts an answer.
                    </p>
                </div>
            </SubSection>
        </div>
    )
}
