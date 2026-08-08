"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import type { ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import toast from "react-hot-toast"
import { CloudOff, Loader2, RotateCw, ShieldAlert } from "lucide-react"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { Button } from "@/components/quiet/Button"
import { Card } from "@/components/quiet/Card"
import { StepIndicator } from "@/components/onboarding/StepIndicator"
import { useAuth } from "@/hooks/useAuth"
import { useProfileVault } from "@/hooks/useProfileVault"
import { cn } from "@/lib/utils"
import type { FieldErrors } from "@/app/onboarding/steps/fields"
import { WelcomeStep } from "@/app/onboarding/steps/WelcomeStep"
import { AboutYouStep } from "@/app/onboarding/steps/AboutYouStep"
import { ExperienceStep } from "@/app/onboarding/steps/ExperienceStep"
import { LinksSkillsStep } from "@/app/onboarding/steps/LinksSkillsStep"
import { EligibilityStep } from "@/app/onboarding/steps/EligibilityStep"
import { AiSetupStep } from "@/app/onboarding/steps/AiSetupStep"
import { ConnectStep } from "@/app/onboarding/steps/ConnectStep"

export const STEP_IDS = [
    "welcome",
    "about",
    "experience",
    "links",
    "eligibility",
    "ai",
    "connect",
] as const

export type StepId = (typeof STEP_IDS)[number]

type StepMeta = {
    label: string
    forwardLabel: string
}

const STEP_META: Record<StepId, StepMeta> = {
    welcome: { label: "Welcome", forwardLabel: "Start with the basics" },
    about: { label: "About you", forwardLabel: "Continue to experience" },
    experience: { label: "Experience", forwardLabel: "Continue to links & skills" },
    links: { label: "Links & skills", forwardLabel: "Continue to work eligibility" },
    eligibility: { label: "Eligibility", forwardLabel: "Continue to AI setup" },
    ai: { label: "AI setup", forwardLabel: "Finish and connect" },
    connect: { label: "Connect", forwardLabel: "" },
}

const RAIL_STEPS = STEP_IDS.slice(1).map((id) => ({ id, label: STEP_META[id].label }))

const STEP_NAMES: readonly string[] = STEP_IDS

export function parseStepId(value: string | null | undefined): StepId | null {
    if (value === null || value === undefined) return null
    return STEP_NAMES.includes(value) ? (value as StepId) : null
}

function stepIndex(step: StepId): number {
    return STEP_IDS.indexOf(step)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function urlProblem(value: string): string | null {
    const trimmed = value.trim()
    if (trimmed === "") return null
    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return "That doesn’t look like a web address — try pasting the full link."
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "Links have to start with http:// or https://."
    }
    return null
}

function validateValue(field: string, value: string): string | null {
    switch (field) {
        case "personal.firstName":
            return value.trim() === "" ? "Application forms always ask for a first name." : null
        case "personal.lastName":
            return value.trim() === "" ? "Application forms always ask for a last name." : null
        case "personal.email": {
            const trimmed = value.trim()
            if (trimmed === "") return "This is the one field no application form will let you skip."
            return EMAIL_PATTERN.test(trimmed) ? null : "That doesn’t look like an email address."
        }
        case "links.linkedin":
        case "links.github":
        case "links.portfolio":
            return urlProblem(value)
        default:
            return null
    }
}

const BLOCKING_FIELDS: Partial<Record<StepId, Record<string, (draft: SharedProfile) => string>>> = {
    about: {
        "personal.firstName": (draft) => draft.personal.firstName,
        "personal.lastName": (draft) => draft.personal.lastName,
        "personal.email": (draft) => draft.personal.email,
    },
    links: {
        "links.linkedin": (draft) => draft.links.linkedin,
        "links.github": (draft) => draft.links.github,
        "links.portfolio": (draft) => draft.links.portfolio,
    },
}

function validateStep(step: StepId, draft: SharedProfile): FieldErrors {
    const errors: FieldErrors = {}
    const fields = BLOCKING_FIELDS[step]
    if (!fields) return errors
    for (const [field, read] of Object.entries(fields)) {
        const problem = validateValue(field, read(draft))
        if (problem !== null) errors[field] = problem
    }
    return errors
}

type WizardState = {
    step: StepId
    draft: SharedProfile | null
    errors: FieldErrors
    pendingStep: StepId | null
    furthestIndex: number
    skippedAi: boolean
    lastSaveFailed: boolean
}

type WizardAction =
    | { type: "hydrate"; profile: SharedProfile }
    | { type: "patch"; patch: Partial<SharedProfile> }
    | { type: "fieldError"; field: string; message: string | null }
    | { type: "blockWith"; errors: FieldErrors }
    | { type: "requestStep"; step: StepId }
    | { type: "commitStep"; saved: boolean }
    | { type: "syncStep"; step: StepId }
    | { type: "skipAi" }

function reducer(state: WizardState, action: WizardAction): WizardState {
    switch (action.type) {
        case "hydrate":
            return { ...state, draft: action.profile }
        case "patch":
            return state.draft === null
                ? state
                : { ...state, draft: { ...state.draft, ...action.patch } }
        case "fieldError": {
            const errors = { ...state.errors }
            if (action.message === null) delete errors[action.field]
            else errors[action.field] = action.message
            return { ...state, errors }
        }
        case "blockWith":
            return { ...state, errors: { ...state.errors, ...action.errors } }
        case "requestStep":
            return { ...state, pendingStep: action.step }
        case "commitStep": {
            const step = state.pendingStep ?? state.step
            return {
                ...state,
                step,
                pendingStep: null,
                errors: {},
                furthestIndex: Math.max(state.furthestIndex, stepIndex(step)),
                lastSaveFailed: !action.saved,
            }
        }
        case "syncStep":
            return {
                ...state,
                step: action.step,
                pendingStep: null,
                errors: {},
                furthestIndex: Math.max(state.furthestIndex, stepIndex(action.step)),
            }
        case "skipAi":
            return { ...state, skippedAi: true }
    }
}

function initialState(step: StepId): WizardState {
    return {
        step,
        draft: null,
        errors: {},
        pendingStep: null,
        furthestIndex: stepIndex(step),
        skippedAi: false,
        lastSaveFailed: false,
    }
}

type AuthUser = { firstName: string | null; lastName: string | null; email: string }

function withIdentityPrefill(profile: SharedProfile, user: AuthUser | null): SharedProfile {
    if (user === null) return profile
    const personal = { ...profile.personal }
    if (personal.firstName.trim() === "" && user.firstName) personal.firstName = user.firstName
    if (personal.lastName.trim() === "" && user.lastName) personal.lastName = user.lastName
    if (personal.email.trim() === "" && user.email) personal.email = user.email
    return { ...profile, personal }
}

function wizardPatch(draft: SharedProfile): Partial<SharedProfile> {
    return {
        summary: draft.summary,
        personal: draft.personal,
        links: draft.links,
        work: draft.work,
        education: draft.education,
        skills: draft.skills,
        authorization: draft.authorization,
        eeo: draft.eeo,
        updatedAt: Date.now(),
    }
}

export function OnboardingWizard({ initialStep }: { initialStep: StepId }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const reduceMotion = useReducedMotion()
    const { user } = useAuth()
    const {
        status,
        profile,
        vaultKey,
        error,
        errorKind,
        ensureVaultKey,
        load,
        update,
        save,
        exportRecoveryKey,
    } = useProfileVault()

    const [state, dispatch] = useReducer(reducer, initialStep, initialState)

    const vaultActions = useRef({ update, save })
    useEffect(() => {
        vaultActions.current = { update, save }
    })

    const bootstrapped = useRef(false)
    useEffect(() => {
        if (bootstrapped.current) return
        bootstrapped.current = true
        void (async () => {
            try {
                await ensureVaultKey()
                await load()
            } catch {
                // Failure is already reflected in `status`/`error`; the retry card renders from those.
            }
        })()
    }, [ensureVaultKey, load])

    const hydrated = state.draft !== null
    useEffect(() => {
        if (hydrated || status !== "ready" || profile === null) return
        dispatch({ type: "hydrate", profile: withIdentityPrefill(profile, user) })
    }, [hydrated, status, profile, user])

    const urlStep = searchParams.get("step")
    const stepRef = useRef(state.step)
    stepRef.current = state.step
    useEffect(() => {
        const parsed = parseStepId(urlStep)
        if (parsed !== null && parsed !== stepRef.current) dispatch({ type: "syncStep", step: parsed })
    }, [urlStep])

    useEffect(() => {
        if (parseStepId(urlStep) === state.step) return
        router.replace(`${pathname}?step=${state.step}`, { scroll: false })
    }, [state.step, urlStep, pathname, router])

    const savingRef = useRef(false)
    useEffect(() => {
        const target = state.pendingStep
        if (target === null || savingRef.current) return
        savingRef.current = true
        void (async () => {
            const saved = await vaultActions.current.save()
            savingRef.current = false
            if (!saved) {
                toast.error(
                    "We couldn’t reach your vault just then. Nothing is lost — we’ll try again on the next step.",
                )
            }
            dispatch({ type: "commitStep", saved })
        })()
    }, [state.pendingStep])

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
    }, [state.step, reduceMotion])

    const patch = useCallback((next: Partial<SharedProfile>) => {
        dispatch({ type: "patch", patch: next })
    }, [])

    const onBlurField = useCallback((field: string, value: string) => {
        dispatch({ type: "fieldError", field, message: validateValue(field, value) })
    }, [])

    const draft = state.draft
    const goTo = useCallback(
        (target: StepId) => {
            if (state.pendingStep !== null || draft === null) return
            if (stepIndex(target) > stepIndex(state.step)) {
                const problems = validateStep(state.step, draft)
                if (Object.keys(problems).length > 0) {
                    dispatch({ type: "blockWith", errors: problems })
                    return
                }
            }
            vaultActions.current.update(wizardPatch(draft))
            dispatch({ type: "requestStep", step: target })
        },
        [state.pendingStep, state.step, draft],
    )

    const currentIndex = stepIndex(state.step)
    const previousStep = currentIndex > 0 ? STEP_IDS[currentIndex - 1] : undefined
    const nextStep = currentIndex < STEP_IDS.length - 1 ? STEP_IDS[currentIndex + 1] : undefined
    const busy = state.pendingStep !== null

    const stepBody = useMemo(() => {
        if (draft === null) return null
        const stepProps = { draft, errors: state.errors, patch, onBlurField }
        switch (state.step) {
            case "welcome":
                return (
                    <WelcomeStep
                        firstName={draft.personal.firstName || user?.firstName || ""}
                        busy={busy}
                        onStart={() => goTo("about")}
                    />
                )
            case "about":
                return <AboutYouStep {...stepProps} />
            case "experience":
                return <ExperienceStep {...stepProps} />
            case "links":
                return <LinksSkillsStep {...stepProps} />
            case "eligibility":
                return <EligibilityStep {...stepProps} />
            case "ai":
                return <AiSetupStep />
            case "connect":
                return (
                    <ConnectStep
                        draft={draft}
                        vaultKey={vaultKey}
                        skippedAi={state.skippedAi}
                        saving={busy}
                        saveFailed={state.lastSaveFailed}
                        onSaveAgain={() => goTo("connect")}
                        onExportRecoveryKey={exportRecoveryKey}
                    />
                )
        }
    }, [
        draft,
        state.errors,
        state.step,
        state.skippedAi,
        state.lastSaveFailed,
        patch,
        onBlurField,
        goTo,
        busy,
        user,
        vaultKey,
        exportRecoveryKey,
    ])

    if (status === "error" && !hydrated) {
        const offline = errorKind === "network"
        return (
            <WizardShell>
                <Card className="flex flex-col items-start gap-4 p-6">
                    {offline ? (
                        <CloudOff className="size-5 text-fg2" />
                    ) : (
                        <ShieldAlert className="size-5 text-dan" />
                    )}
                    <div className="flex flex-col gap-1">
                        <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">
                            {offline ? "We couldn’t reach NextMove" : "We couldn’t open your vault"}
                        </h1>
                        <p className="text-[13px] leading-relaxed text-fg2">
                            {error ??
                                "Your profile is stored encrypted, and the key lives in this browser. If you started onboarding somewhere else, open this page there — or start fresh here and import later."}
                        </p>
                    </div>
                    <Button variant="sec" onClick={() => void load()}>
                        <RotateCw className="size-4" />
                        Try again
                    </Button>
                </Card>
            </WizardShell>
        )
    }

    if (!hydrated) {
        return (
            <WizardShell>
                <Card
                    role="status"
                    aria-label="Opening your profile vault"
                    className="flex min-h-64 items-center justify-center"
                >
                    <span className="flex items-center gap-2 text-[13px] text-fg2">
                        <Loader2 className="size-4 animate-spin" />
                        Opening your vault…
                    </span>
                </Card>
            </WizardShell>
        )
    }

    const isFormStep = currentIndex > 0 && currentIndex < STEP_IDS.length - 1
    const showRail = currentIndex > 0
    const showFooter = isFormStep

    return (
        <WizardShell>
            {showRail ? (
                <StepIndicator
                    steps={RAIL_STEPS}
                    currentIndex={currentIndex - 1}
                    furthestIndex={state.furthestIndex - 1}
                    onSelect={(id) => {
                        const parsed = parseStepId(id)
                        if (parsed !== null) goTo(parsed)
                    }}
                />
            ) : null}

            {error !== null ? (
                <div
                    role="status"
                    className="flex items-start gap-3 rounded-[10px] border border-warn/40 bg-warnbg p-4"
                >
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                    <p className="text-xs leading-relaxed text-fg2">{error}</p>
                </div>
            ) : null}

            <Card className="p-6 shadow-qmd md:p-8">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={state.step}
                        initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                        transition={{ duration: reduceMotion ? 0 : 0.14, ease: "easeOut" }}
                    >
                        {stepBody}
                    </motion.div>
                </AnimatePresence>

                {showFooter ? (
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-6">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy || previousStep === undefined}
                            aria-label={
                                previousStep ? `Back to ${STEP_META[previousStep].label}` : undefined
                            }
                            onClick={() => previousStep && goTo(previousStep)}
                        >
                            Back
                        </Button>

                        <div className="flex flex-wrap items-center gap-3">
                            {state.step === "ai" ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => {
                                        dispatch({ type: "skipAi" })
                                        goTo("connect")
                                    }}
                                >
                                    Skip for now
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="acc"
                                className="px-5 py-2.5"
                                disabled={busy || nextStep === undefined}
                                onClick={() => nextStep && goTo(nextStep)}
                            >
                                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                                {busy ? "Saving…" : STEP_META[state.step].forwardLabel}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Card>

            <p className={cn("text-center text-xs text-fg2", !isFormStep && "sr-only")}>
                Everything here is encrypted in this browser before it is stored. We hold the
                ciphertext; only you hold the key.
            </p>
        </WizardShell>
    )
}

function WizardShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen w-full bg-well px-6 pt-10 pb-14">
            <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">{children}</div>
        </div>
    )
}
