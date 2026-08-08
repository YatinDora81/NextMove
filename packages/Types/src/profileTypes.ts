import { z } from "zod"

export const remotePreferenceSchema = z.enum(["onsite", "hybrid", "remote", "flexible"])
export const compensationPeriodSchema = z.enum(["hour", "day", "month", "year"])

export type RemotePreference = z.infer<typeof remotePreferenceSchema>
export type CompensationPeriod = z.infer<typeof compensationPeriodSchema>

const epochMs = z.number().int().nonnegative()

export const postalAddressSchema = z.object({
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
})

export const profilePersonalSchema = z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    phone: z.string(),
    address: postalAddressSchema,
})

export const profileLinksSchema = z.object({
    linkedin: z.string(),
    github: z.string(),
    portfolio: z.string(),
    other: z.array(z.string()),
})

export const workEntrySchema = z.object({
    title: z.string(),
    company: z.string(),
    location: z.string(),
    start: z.string(),
    end: z.string().nullable(),
    current: z.boolean(),
    bullets: z.array(z.string()),
})

export const educationEntrySchema = z.object({
    school: z.string(),
    degree: z.string(),
    field: z.string(),
    start: z.string(),
    end: z.string().nullable(),
    gpa: z.string(),
})

export const profileAuthorizationSchema = z.object({
    authorizedIn: z.array(z.string()),
    needsSponsorship: z.record(z.string(), z.boolean()),
    visaStatus: z.string(),
    willingToRelocate: z.boolean(),
    remotePreference: remotePreferenceSchema,
})

export const profileEeoSchema = z.object({
    gender: z.string(),
    ethnicity: z.string(),
    veteran: z.string(),
    disability: z.string(),
    declineToState: z.boolean(),
})

export const expectedCompensationSchema = z.object({
    amount: z.number(),
    currency: z.string(),
    period: compensationPeriodSchema,
})

export const profileCompensationSchema = z.object({
    expected: expectedCompensationSchema,
    noticePeriodDays: z.number().int().nonnegative(),
})

export const profileAnswerSchema = z.object({
    q: z.string(),
    a: z.string(),
    reusable: z.boolean(),
})

export const profileSchema = z.object({
    id: z.string(),
    label: z.string(),
    isDefault: z.boolean(),
    summary: z.string().optional(),
    personal: profilePersonalSchema,
    links: profileLinksSchema,
    work: z.array(workEntrySchema),
    education: z.array(educationEntrySchema),
    skills: z.array(z.string()),
    authorization: profileAuthorizationSchema,
    eeo: profileEeoSchema,
    compensation: profileCompensationSchema,
    answers: z.array(profileAnswerSchema),
    updatedAt: epochMs,
})

export const profilePatchSchema = profileSchema.partial()

export const resumeExtractOutputSchema = profileSchema.omit({
    id: true,
    label: true,
    isDefault: true,
    updatedAt: true,
})

export const profileListSchema = z.array(profileSchema)

export type PostalAddress = z.infer<typeof postalAddressSchema>
export type ProfilePersonal = z.infer<typeof profilePersonalSchema>
export type ProfileLinks = z.infer<typeof profileLinksSchema>
export type WorkEntry = z.infer<typeof workEntrySchema>
export type EducationEntry = z.infer<typeof educationEntrySchema>
export type ProfileAuthorization = z.infer<typeof profileAuthorizationSchema>
export type ProfileEeo = z.infer<typeof profileEeoSchema>
export type ExpectedCompensation = z.infer<typeof expectedCompensationSchema>
export type ProfileCompensation = z.infer<typeof profileCompensationSchema>
export type ProfileAnswer = z.infer<typeof profileAnswerSchema>
export type SharedProfile = z.infer<typeof profileSchema>
export type SharedProfileDraft = z.infer<typeof resumeExtractOutputSchema>

export const PROFILE_VAULT_SCHEMA_VERSION = 1

export const syncProfileVaultSchema = z.object({
    schemaVersion: z.number().int().positive(),
    exportedAt: epochMs,
    activeProfileId: z.string().nullable(),
    profiles: z.array(profileSchema),
})

export type SyncProfileVault = z.infer<typeof syncProfileVaultSchema>

const EMPTY: SharedProfile = {
    id: "",
    label: "",
    isDefault: false,
    summary: "",
    personal: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        address: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" },
    },
    links: { linkedin: "", github: "", portfolio: "", other: [] },
    work: [],
    education: [],
    skills: [],
    authorization: {
        authorizedIn: [],
        needsSponsorship: {},
        visaStatus: "",
        willingToRelocate: false,
        remotePreference: "flexible",
    },
    eeo: { gender: "", ethnicity: "", veteran: "", disability: "", declineToState: false },
    compensation: { expected: { amount: 0, currency: "", period: "year" }, noticePeriodDays: 0 },
    answers: [],
    updatedAt: 0,
}

export const EMPTY_PROFILE: SharedProfile = EMPTY

export function createEmptyProfile(id: string, label: string, now: number): SharedProfile {
    return {
        ...EMPTY,
        id,
        label,
        summary: "",
        personal: { ...EMPTY.personal, address: { ...EMPTY.personal.address } },
        links: { ...EMPTY.links, other: [] },
        work: [],
        education: [],
        skills: [],
        authorization: { ...EMPTY.authorization, authorizedIn: [], needsSponsorship: {} },
        eeo: { ...EMPTY.eeo },
        compensation: {
            expected: { ...EMPTY.compensation.expected },
            noticePeriodDays: EMPTY.compensation.noticePeriodDays,
        },
        answers: [],
        updatedAt: now,
    }
}

export function draftToProfile(
    draft: SharedProfileDraft,
    id: string,
    label: string,
    now: number,
): SharedProfile {
    return { ...draft, id, label, isDefault: false, updatedAt: now }
}

export function buildSyncProfileVault(
    profiles: readonly SharedProfile[],
    activeProfileId: string | null,
    now: number,
): SyncProfileVault {
    return {
        schemaVersion: PROFILE_VAULT_SCHEMA_VERSION,
        exportedAt: now,
        activeProfileId,
        profiles: profiles.map((profile) => profileSchema.parse(profile)),
    }
}
