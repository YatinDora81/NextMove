"use client"

/**
 * Step 5 — Work eligibility, and the voluntary EEO block.
 *
 * Two questions get asked on essentially every application form in the world: "are you legally
 * authorised to work in X?" and "will you now or in the future require sponsorship?". They are not
 * the same question and the honest answer to both can be yes, so the model keeps them as two
 * independent country lists rather than one toggle.
 *
 * The EEO block is different in kind: it is voluntary, it is collected for reporting rather than
 * for hiring, and a product that silently pre-fills it would be making a decision on the user's
 * behalf. So the copy says so plainly, "decline to state" is a first-class switch, and turning it
 * on disables the rest instead of hiding it — the answers stay put in case it is turned back off.
 */

import { Info } from "lucide-react"
import type { ProfileEeo, RemotePreference } from "@repo/types/ProfileTypes"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ChipInput, StepHeader, SubSection, ToggleChip, type StepProps } from "@/app/onboarding/steps/fields"

/** The jurisdictions application forms actually name. Anything else goes in the free-text list. */
const COMMON_COUNTRIES: readonly string[] = [
    "United States",
    "Canada",
    "United Kingdom",
    "European Union",
    "Germany",
    "Australia",
    "India",
]

const REMOTE_OPTIONS: readonly { value: RemotePreference; label: string; hint: string }[] = [
    { value: "onsite", label: "On-site", hint: "In the office, most days." },
    { value: "hybrid", label: "Hybrid", hint: "A couple of days in, the rest at home." },
    { value: "remote", label: "Remote", hint: "Fully remote only." },
    { value: "flexible", label: "Flexible", hint: "Open to whatever the role needs." },
]

const GENDER_OPTIONS: readonly string[] = ["Male", "Female", "Non-binary", "Prefer not to say"]

const ETHNICITY_OPTIONS: readonly string[] = [
    "Hispanic or Latino",
    "White (Not Hispanic or Latino)",
    "Black or African American",
    "Asian",
    "Native Hawaiian or Other Pacific Islander",
    "American Indian or Alaska Native",
    "Two or More Races",
    "Prefer not to say",
]

const VETERAN_OPTIONS: readonly string[] = [
    "I am not a protected veteran",
    "I identify as one or more classifications of protected veteran",
    "Prefer not to say",
]

const DISABILITY_OPTIONS: readonly string[] = [
    "Yes, I have a disability, or have had one in the past",
    "No, I do not have a disability",
    "Prefer not to say",
]

function EeoSelect({
    label,
    value,
    options,
    disabled,
    onChange,
}: {
    label: string
    value: string
    options: readonly string[]
    disabled: boolean
    onChange: (value: string) => void
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label>{label}</Label>
            <Select value={value} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Not answered" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option} value={option}>
                            {option}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}

export function EligibilityStep({ draft, patch }: StepProps) {
    const { authorization, eeo } = draft
    const declined = eeo.declineToState

    const setEeo = (next: Partial<ProfileEeo>) => patch({ eeo: { ...eeo, ...next } })

    const toggleAuthorised = (country: string) => {
        const authorizedIn = authorization.authorizedIn.includes(country)
            ? authorization.authorizedIn.filter((item) => item !== country)
            : [...authorization.authorizedIn, country]
        patch({ authorization: { ...authorization, authorizedIn } })
    }

    // `needsSponsorship` is a country → boolean map; a country is "off" when its entry is removed,
    // not when it is set to false, so the map never accumulates dead keys.
    const sponsorshipCountries = Object.keys(authorization.needsSponsorship).filter(
        (country) => authorization.needsSponsorship[country] === true,
    )

    const toggleSponsorship = (country: string) => {
        const needsSponsorship = { ...authorization.needsSponsorship }
        if (needsSponsorship[country] === true) delete needsSponsorship[country]
        else needsSponsorship[country] = true
        patch({ authorization: { ...authorization, needsSponsorship } })
    }

    const setSponsorshipList = (countries: string[]) => {
        const needsSponsorship: Record<string, boolean> = {}
        for (const country of countries) needsSponsorship[country] = true
        patch({ authorization: { ...authorization, needsSponsorship } })
    }

    const extraAuthorised = authorization.authorizedIn.filter(
        (country) => !COMMON_COUNTRIES.includes(country),
    )
    const extraSponsorship = sponsorshipCountries.filter(
        (country) => !COMMON_COUNTRIES.includes(country),
    )

    return (
        <div className="flex flex-col gap-8">
            <StepHeader
                title="Work eligibility"
                description="The compliance questions every form asks. Answer them once here and the extension stops you having to think about them again."
            />

            <SubSection
                title="Where you can work"
                hint="Two independent lists: authorisation is about today, sponsorship is about what an employer would have to do."
            >
                <div className="flex flex-col gap-2">
                    <Label>Where can you work without sponsorship?</Label>
                    <div className="flex flex-wrap gap-2">
                        {COMMON_COUNTRIES.map((country) => (
                            <ToggleChip
                                key={country}
                                label={country}
                                selected={authorization.authorizedIn.includes(country)}
                                onToggle={() => toggleAuthorised(country)}
                            />
                        ))}
                    </div>
                    <ChipInput
                        label="Somewhere else"
                        values={extraAuthorised}
                        placeholder="Add a country and press Enter"
                        onChange={(values) =>
                            patch({
                                authorization: {
                                    ...authorization,
                                    authorizedIn: [
                                        ...authorization.authorizedIn.filter((country) =>
                                            COMMON_COUNTRIES.includes(country),
                                        ),
                                        ...values,
                                    ],
                                },
                            })
                        }
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <Label>Where would you need visa sponsorship?</Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Both lists can contain the same country in different circumstances — pick what is
                        true today.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {COMMON_COUNTRIES.map((country) => (
                            <ToggleChip
                                key={country}
                                label={country}
                                selected={authorization.needsSponsorship[country] === true}
                                onToggle={() => toggleSponsorship(country)}
                            />
                        ))}
                    </div>
                    <ChipInput
                        label="Somewhere else"
                        values={extraSponsorship}
                        placeholder="Add a country and press Enter"
                        onChange={(values) =>
                            setSponsorshipList([
                                ...sponsorshipCountries.filter((country) =>
                                    COMMON_COUNTRIES.includes(country),
                                ),
                                ...values,
                            ])
                        }
                    />
                </div>

            </SubSection>

            <SubSection title="Status and preferences">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="visa-status">Current visa or work status</Label>
                        <Input
                            id="visa-status"
                            value={authorization.visaStatus}
                            placeholder="Citizen, Permanent resident, H-1B, F-1 OPT…"
                            onChange={(event) =>
                                patch({
                                    authorization: { ...authorization, visaStatus: event.target.value },
                                })
                            }
                        />
                        <p className="text-xs text-muted-foreground">
                            Free text — forms word this differently everywhere.
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="relocate">Willing to relocate</Label>
                        <div className="flex h-9 items-center gap-3">
                            <Switch
                                id="relocate"
                                checked={authorization.willingToRelocate}
                                onCheckedChange={(checked) =>
                                    patch({
                                        authorization: { ...authorization, willingToRelocate: checked },
                                    })
                                }
                            />
                            <span className="text-sm text-muted-foreground">
                                {authorization.willingToRelocate ? "Yes, for the right role" : "No"}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <Label>Where you want to work from</Label>
                    <RadioGroup
                        className="grid gap-2 sm:grid-cols-2"
                        value={authorization.remotePreference}
                        onValueChange={(value) =>
                            patch({
                                authorization: {
                                    ...authorization,
                                    remotePreference: value as RemotePreference,
                                },
                            })
                        }
                    >
                        {REMOTE_OPTIONS.map((option) => (
                            <label
                                key={option.value}
                                htmlFor={`remote-${option.value}`}
                                className={cn(
                                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                                    authorization.remotePreference === option.value
                                        ? "border-primary bg-primary/5"
                                        : "border-border hover:bg-muted/40",
                                )}
                            >
                                <RadioGroupItem
                                    id={`remote-${option.value}`}
                                    value={option.value}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="block text-sm font-medium">{option.label}</span>
                                    <span className="block text-xs text-muted-foreground">
                                        {option.hint}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </div>
            </SubSection>

            <SubSection title="Voluntary self-identification">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
                    <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        These questions are voluntary. Employers collect them for equal-opportunity
                        reporting, they are kept separate from hiring decisions, and declining costs you
                        nothing. Leave them blank and the extension leaves those form fields alone.
                    </p>
                </div>

                <label
                    htmlFor="eeo-decline"
                    className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4"
                >
                    <span>
                        <span className="block text-sm font-medium">Decline to state on every form</span>
                        <span className="block text-xs text-muted-foreground">
                            The extension will pick “I don’t wish to answer” wherever a form offers it.
                        </span>
                    </span>
                    <Switch
                        id="eeo-decline"
                        checked={declined}
                        onCheckedChange={(checked) => setEeo({ declineToState: checked })}
                    />
                </label>

                <div
                    aria-hidden={declined}
                    className={cn(
                        "grid gap-4 transition-opacity sm:grid-cols-2",
                        declined && "pointer-events-none opacity-40",
                    )}
                >
                    <EeoSelect
                        label="Gender"
                        value={eeo.gender}
                        options={GENDER_OPTIONS}
                        disabled={declined}
                        onChange={(value) => setEeo({ gender: value })}
                    />
                    <EeoSelect
                        label="Race or ethnicity"
                        value={eeo.ethnicity}
                        options={ETHNICITY_OPTIONS}
                        disabled={declined}
                        onChange={(value) => setEeo({ ethnicity: value })}
                    />
                    <EeoSelect
                        label="Veteran status"
                        value={eeo.veteran}
                        options={VETERAN_OPTIONS}
                        disabled={declined}
                        onChange={(value) => setEeo({ veteran: value })}
                    />
                    <EeoSelect
                        label="Disability status"
                        value={eeo.disability}
                        options={DISABILITY_OPTIONS}
                        disabled={declined}
                        onChange={(value) => setEeo({ disability: value })}
                    />
                </div>
            </SubSection>
        </div>
    )
}
