/**
 * profileTypes.ts — the job-application profile contract (JF-001 Rev 3.0 SEC 7.2).
 *
 * This lives in `@repo/types` rather than inside the extension because, since the web onboarding
 * wizard became the place a profile is *authored*, three runtimes have to agree on its shape:
 *
 *   apps/web        builds a profile from the onboarding form and seals it (@repo/vault)
 *   apps/extension  opens the sealed vault and fills forms from it
 *   packages/vault  parses the decrypted payload before handing it to either
 *
 * `apps/http-server` deliberately does **not** import this. The server stores `ProfileBlob` as
 * opaque ciphertext and has no business knowing what is inside it (SEC 7.4) — if a controller ever
 * needs this file, that is the review signal that the server-blind property is being broken.
 *
 * The extension keeps its hand-written `Profile` interface and asserts structural equality against
 * these schemas at compile time, so drift between the two is a type error, not a runtime surprise.
 */

import { z } from "zod"

/* ------------------------------------------------------------------------------------------------
 * Leaf enums
 * ---------------------------------------------------------------------------------------------- */

export const remotePreferenceSchema = z.enum(["onsite", "hybrid", "remote", "flexible"])
export const compensationPeriodSchema = z.enum(["hour", "day", "month", "year"])

export type RemotePreference = z.infer<typeof remotePreferenceSchema>
export type CompensationPeriod = z.infer<typeof compensationPeriodSchema>

const epochMs = z.number().int().nonnegative()

/* ------------------------------------------------------------------------------------------------
 * The vault (SEC 7.2)
 * ---------------------------------------------------------------------------------------------- */

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

/**
 * The vault contract. Strict by design: `resume_extract.v1` must return this exact shape minus the
 * identity fields, and an invalid generation gets one repair prompt (SEC 5.6).
 */
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

/** Partial patch used by the options editor, the onboarding wizard, and draft merges. */
export const profilePatchSchema = profileSchema.partial()

/**
 * SEC 5.5 `resume_extract.v1` output contract — everything a resume can tell us. The client
 * assigns id/label/isDefault/updatedAt; the model never invents them.
 */
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

/* ------------------------------------------------------------------------------------------------
 * The sealed payload (SEC 7.4)
 * ---------------------------------------------------------------------------------------------- */

/** Bumped whenever the sealed payload's shape changes. Mirrors the extension's SCHEMA_VERSION. */
export const PROFILE_VAULT_SCHEMA_VERSION = 1

/**
 * Exactly what a `ProfileBlob` decrypts to. Closed by construction — Zod strips unknown keys and
 * this schema has no slot for API keys (INV-5), the Answer Bank, resumes, or settings. Growing it
 * is a deliberate act, not an accident.
 */
export const syncProfileVaultSchema = z.object({
    schemaVersion: z.number().int().positive(),
    exportedAt: epochMs,
    activeProfileId: z.string().nullable(),
    profiles: z.array(profileSchema),
})

export type SyncProfileVault = z.infer<typeof syncProfileVaultSchema>

/* ------------------------------------------------------------------------------------------------
 * Constructors
 * ---------------------------------------------------------------------------------------------- */

/** A fully-formed but empty vault. Never exported by reference — see `createEmptyProfile`. */
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

/** Deep clone of `EMPTY_PROFILE` with identity applied. Never returns a shared reference. */
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

/** Promote a `resume_extract.v1` draft into a real profile. */
export function draftToProfile(
    draft: SharedProfileDraft,
    id: string,
    label: string,
    now: number,
): SharedProfile {
    return { ...draft, id, label, isDefault: false, updatedAt: now }
}

/** Builds the plaintext payload for a push. Nothing else may be added to it — INV-5 / SEC 7.4. */
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
