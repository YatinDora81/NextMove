import type { Metadata } from "next"
import Link from "next/link"
import {
    AlarmClock,
    ArrowRight,
    Ban,
    CheckCircle2,
    CircleSlash,
    Cpu,
    Eye,
    FileText,
    Globe,
    HardDrive,
    KeyRound,
    Lock,
    MousePointerClick,
    MousePointerSquareDashed,
    ShieldCheck,
    Sparkles,
    WifiOff,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, Well } from "@/components/quiet/Card"
import { Chip } from "@/components/quiet/Chip"
import { Field, Input } from "@/components/quiet/Field"

export const metadata: Metadata = {
    title: "NextMove Autofill for Chrome | NextMoveApp",
    description:
        "Fill any job application in one click. Your profile, resumes and API keys stay on your device, and nothing is ever submitted for you.",
    openGraph: {
        title: "NextMove Autofill for Chrome",
        description:
            "One-click autofill for Greenhouse, Lever, Workday, Ashby and the long tail of career pages. Local-first, never auto-submits.",
        type: "website",
    },
}

const CHROME_STORE_URL =
    process.env.NEXT_PUBLIC_CHROME_STORE_URL ?? "https://chromewebstore.google.com/search/NextMove%20Autofill"

const BTN =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-transparent text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
const BTN_ACC = `${BTN} bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong`
const BTN_SEC = `${BTN} border-hair2 bg-surface text-fg shadow-qsm hover:bg-well`
const OV = "text-[11px] font-medium uppercase tracking-[.09em] text-fg3"
const H2 = "text-[clamp(22px,2.6vw,30px)] font-[650] leading-[1.15] tracking-[-0.022em]"

const CLAIMS: { lead: string; tail: string }[] = [
    { lead: "Never auto-submits.", tail: "You always press the button." },
    { lead: "Keys stay on-device.", tail: "Encrypted locally, never sent to us." },
    { lead: "Works offline.", tail: "Guest mode is fully local." },
]

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
    {
        icon: FileText,
        title: "Set up your profile once",
        body: "Import a resume and let the extension extract the boring parts — name, contacts, education, work history, authorization answers. Everything lands in a local vault you can edit by hand. This is the only time you type it.",
    },
    {
        icon: MousePointerClick,
        title: "Open an application and press Alt+J",
        body: "The extension reads the form, scores every field against your profile, and fills what it is confident about. Anything it is unsure of is suggested rather than typed, and anything it cannot place is flagged instead of guessed.",
    },
    {
        icon: Eye,
        title: "Review, then submit it yourself",
        body: "Filled fields are highlighted so you can scan them in seconds. You press Submit — the extension never does. The application is logged to your tracker with the company, role and how much of the form was filled.",
    },
]

const PERMISSIONS: { icon: LucideIcon; name: string; label: string; body: string }[] = [
    {
        icon: HardDrive,
        name: "storage",
        label: "Keep your profile on this device",
        body: "Your profile, resumes, saved answers and settings live in the browser's own extension storage, encrypted at rest. This is where your data lives — there is no server copy unless you switch sync on.",
    },
    {
        icon: Cpu,
        name: "scripting",
        label: "Fill the form you are looking at",
        body: "Lets the extension run its fill logic against the application page when you ask it to. It is never used to load code from a server: the store build contains no remote code, which is also what the store's policy requires.",
    },
    {
        icon: AlarmClock,
        name: "alarms",
        label: "Two scheduled timers, nothing else",
        body: "One daily check for updated form selectors — ATS vendors move their markup and we ship fixes without a new release — and one reset of the daily AI quota counters at midnight Pacific.",
    },
    {
        icon: MousePointerSquareDashed,
        name: "contextMenus",
        label: "Right-click entries",
        body: "Adds “Fill this application” and “Draft an answer” to the right-click menu, so you can start a fill without opening the popup.",
    },
    {
        icon: Sparkles,
        name: "generativelanguage.googleapis.com",
        label: "Talk to Gemini with your own key",
        body: "When you click the AI button, the request goes straight from your browser to Google over TLS, signed with the free Gemini key you added. It never passes through NextMove's servers, and we never see the key.",
    },
    {
        icon: Globe,
        name: "nextmove-yatin.vercel.app",
        label: "Selector updates and optional sync",
        body: "Downloads the versioned selector file that keeps the ATS adapters working, and — only if you choose to pair the extension with your account — syncs your application tracker.",
    },
]

const NOT_REQUESTED: { name: string; why: string }[] = [
    { name: "tabs", why: "we never enumerate what you have open" },
    { name: "history", why: "we never read where you have been" },
    { name: "cookies", why: "we never touch your sessions" },
    { name: "webRequest", why: "we never intercept your traffic" },
]

const PRIVACY_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
    {
        icon: Lock,
        title: "Profile and resumes never leave the device",
        body: "Everything sensitive — contact details, work history, EEO answers, visa status, salary expectations, resume files — is encrypted at rest in local storage. It leaves your machine in exactly two cases: when you click the AI button (straight to Google), or when you deliberately turn on sync, which uploads a blob we cannot decrypt.",
    },
    {
        icon: KeyRound,
        title: "Your Gemini keys are yours",
        body: "You bring your own free Google AI Studio keys. They are stored encrypted, held in memory only for the moment a request is made, and are never synced, exported, logged, or shown back to you in full. There is no code path that sends a key to a NextMove server.",
    },
    {
        icon: Ban,
        title: "It never presses Submit",
        body: "This is a hard rule in the codebase, not a setting: no code path clicks a submit or “next step” button. On multi-step applications the extension will find and highlight the next button so you know where to click — and then wait for you.",
    },
    {
        icon: WifiOff,
        title: "It works with the network off",
        body: "Filling, matching, your answer bank and your tracker are all local. If our API is down — or you never sign in at all — the extension still does its job. Sync is the only feature that needs us.",
    },
    {
        icon: CircleSlash,
        title: "AI runs only when you ask",
        body: "There is no background AI, no speculative pre-generation, no “let's summarise this page just in case”. Every AI call is tied to a click you just made, and expires seconds later if it isn't used.",
    },
    {
        icon: ShieldCheck,
        title: "Pages that aren't applications are ignored",
        body: "The extension wakes up, looks for application-shaped fields, and if it doesn't find any it goes back to sleep and records nothing at all — not the URL, not the page, not the visit.",
    },
]

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
    return (
        <div className="mx-auto max-w-[560px] text-center">
            <div className={OV}>{eyebrow}</div>
            <h2 className={`mt-2.5 ${H2}`}>{title}</h2>
            <p className="mt-2.5 text-sm leading-[1.65] text-fg2">{body}</p>
        </div>
    )
}

export default function ExtensionPage() {
    return (
        <main className="min-h-screen bg-bg px-6 pb-[76px] font-sans text-fg">
            <section className="mx-auto grid max-w-[1020px] items-center gap-11 pt-[60px] md:grid-cols-[1fr_1.15fr]">
                <div>
                    <div className={OV}>NextMove Autofill &middot; v3.0.1</div>
                    <h1 className="mt-3 text-[clamp(32px,4vw,44px)] font-[650] leading-[1.08] tracking-[-0.028em]">
                        The last job form you&apos;ll fill by hand.
                    </h1>
                    <p className="mt-4 max-w-[420px] text-[15px] leading-[1.6] text-fg2">
                        Greenhouse, Lever, Workday and more &mdash; filled in about a second, signed in or not.
                    </p>
                    <div className="mt-[22px] flex flex-wrap gap-2.5">
                        <a
                            href={CHROME_STORE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${BTN_ACC} px-[17px] py-2.5`}
                        >
                            Add to Chrome &mdash; free
                        </a>
                        <a href="#permissions" className={`${BTN_SEC} px-[17px] py-2.5`}>
                            What it can access
                            <ArrowRight className="size-3.5" strokeWidth={1.5} />
                        </a>
                    </div>
                    <div className="mt-6 flex flex-col gap-2.5">
                        {CLAIMS.map((claim) => (
                            <div key={claim.lead} className="flex items-center gap-2.5 text-[13.5px]">
                                <CheckCircle2 className="size-4 flex-none text-ok" strokeWidth={1.5} />
                                <b className="font-semibold">{claim.lead}</b>
                                <span className="text-[13px] text-fg2">{claim.tail}</span>
                            </div>
                        ))}
                    </div>
                    <p className="mt-4 text-[13px] text-fg3">
                        Chrome 116+. No account required to use it &mdash; sign in only if you want your tracker to
                        follow you between machines.
                    </p>
                </div>

                <Card className="px-5 py-[18px] shadow-qmd">
                    <div className="flex items-center gap-2">
                        <span className={`${OV} text-[10.5px]`}>jobs.lever.co/razorpay</span>
                        <span className="tnum ml-auto text-xs text-fg2">19 of 21 filled</span>
                    </div>
                    <Well className="mt-2.5 h-[5px] overflow-hidden rounded-full">
                        <div className="h-full w-[90%] rounded-full bg-acc" />
                    </Well>
                    <Field label="Full name">
                        <div className="relative">
                            <Input defaultValue="Yatin Dora" readOnly />
                            <CheckCircle2 className="absolute top-[11px] right-2.5 size-4 text-ok" strokeWidth={1.5} />
                        </div>
                    </Field>
                    <Field label="Notice period">
                        <div className="relative">
                            <Input defaultValue="30 days" readOnly />
                            <CheckCircle2 className="absolute top-[11px] right-2.5 size-4 text-ok" strokeWidth={1.5} />
                        </div>
                    </Field>
                    <div className="mt-4 flex gap-2">
                        <span className={`${BTN_ACC} flex-1 py-2.5`}>Review 2 suggestions</span>
                        <span className={`${BTN_SEC} px-3.5 py-2.5`}>Undo all</span>
                    </div>
                </Card>
            </section>

            <section className="mx-auto mt-[84px] max-w-[1020px]">
                <SectionHeading
                    eyebrow="How it works"
                    title="Three steps, and the last one is still yours"
                    body="The extension does the typing. The decision to apply stays where it belongs."
                />
                <ol className="mt-[26px] grid gap-3.5 md:grid-cols-3">
                    {STEPS.map((step, index) => (
                        <li key={step.title}>
                            <Card className="h-full p-[18px]">
                                <div className="flex items-center gap-2.5">
                                    <span className="tnum text-[11px] font-medium tracking-[.09em] text-fg3">
                                        {`0${index + 1}`}
                                    </span>
                                    <step.icon className="size-4 text-fg2" strokeWidth={1.5} />
                                </div>
                                <h3 className="mt-2.5 text-base leading-[1.3] font-semibold tracking-[-0.012em]">
                                    {step.title}
                                </h3>
                                <p className="mt-[5px] text-[13px] leading-[1.65] text-fg2">{step.body}</p>
                            </Card>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="mx-auto mt-[84px] max-w-[1020px]">
                <SectionHeading
                    eyebrow="Local-first"
                    title="The data never has to go anywhere"
                    body="Autofill tools usually work by uploading your life to a server. This one does not need to, so it does not."
                />
                <div className="mt-[26px] grid gap-3.5 md:grid-cols-2">
                    {PRIVACY_POINTS.map((point) => (
                        <Card key={point.title} className="p-[18px]">
                            <point.icon className="size-4 text-fg2" strokeWidth={1.5} />
                            <h3 className="mt-2.5 text-base leading-[1.3] font-semibold tracking-[-0.012em]">
                                {point.title}
                            </h3>
                            <p className="mt-[5px] text-[13px] leading-[1.65] text-fg2">{point.body}</p>
                        </Card>
                    ))}
                </div>

                <Well className="mt-3.5 px-[18px] py-4">
                    <div className="flex items-center gap-2.5">
                        <Chip tone="warn" dot={false} className="text-[11.5px]">
                            Worth knowing
                        </Chip>
                        <h3 className="text-sm font-semibold">
                            The honest limit of &ldquo;encrypted at rest&rdquo;
                        </h3>
                    </div>
                    <p className="mt-2.5 text-[13px] leading-[1.65] text-fg2">
                        The encryption key is derived from a secret that lives on the same device as the data. That
                        genuinely protects you from someone reading files off the disk or lifting an unencrypted browser
                        backup. It does <strong className="font-semibold text-fg">not</strong> protect you from malware
                        already running as you &mdash; nothing that runs in your own browser can. If you want the
                        stronger guarantee, turn on passphrase mode: the vault is then locked with something only you
                        know, and it is what cross-device sync uses so that our servers hold ciphertext they cannot
                        read.
                    </p>
                </Well>
            </section>

            <section id="permissions" className="mx-auto mt-[84px] max-w-[1020px] scroll-mt-20">
                <SectionHeading
                    eyebrow="Permissions"
                    title="Every permission, in plain English"
                    body="Chrome shows you a list at install time. Here is what each item on that list is actually for."
                />
                <div className="mt-[26px] grid gap-3.5 md:grid-cols-2">
                    {PERMISSIONS.map((permission) => (
                        <Card key={permission.name} className="p-[18px]">
                            <div className="flex flex-wrap items-center gap-2">
                                <permission.icon className="size-4 flex-none text-fg2" strokeWidth={1.5} />
                                <code className="rounded-sm bg-well px-1.5 py-0.5 font-mono text-[11.5px] text-fg2">
                                    {permission.name}
                                </code>
                                <span className="text-[13.5px] font-semibold">{permission.label}</span>
                            </div>
                            <p className="mt-2.5 text-[13px] leading-[1.65] text-fg2">{permission.body}</p>
                        </Card>
                    ))}
                </div>

                <Card className="mt-3.5 p-[18px] md:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <Globe className="size-4 flex-none text-fg2" strokeWidth={1.5} />
                        <code className="rounded-sm bg-well px-1.5 py-0.5 font-mono text-[11.5px] text-fg2">
                            {"<all_urls>"}
                        </code>
                        <h3 className="text-base leading-[1.3] font-semibold tracking-[-0.012em]">
                            &ldquo;Read and change all your data on all websites&rdquo;
                        </h3>
                    </div>

                    <div className="mt-2.5 flex flex-col gap-2.5 text-[13px] leading-[1.65] text-fg2">
                        <p>
                            This is the scary one, and it is worth being precise about. A job application can live on
                            literally any domain: a Greenhouse board, a Lever page, a company&rsquo;s own Workday
                            tenant, or a twelve-person startup&rsquo;s hand-built <code className="font-mono">/careers</code>{" "}
                            form. Chrome has no &ldquo;run on career pages&rdquo; permission, so an extension that works
                            everywhere has to ask for everywhere.
                        </p>
                        <p>
                            <strong className="font-semibold text-fg">What it actually does:</strong> on each page the
                            script starts, looks for application-shaped fields, and if it finds none it stops and stores
                            nothing. No page content, URL, or browsing history is recorded or transmitted for pages that
                            are not applications &mdash; and none of it is transmitted for the ones that are, either,
                            unless you turn on sync.
                        </p>
                        <p>
                            <strong className="font-semibold text-fg">What it never does:</strong> no analytics on your
                            browsing, no injected affiliate links, no scraping listings in bulk, no remotely loaded
                            code. The store listing declares a single purpose &mdash; fill job application forms you are
                            viewing &mdash; and everything in the build conforms to that sentence.
                        </p>
                    </div>

                    <div className="mt-4 border-t border-hair pt-4">
                        <p className="text-[13px] font-semibold">
                            And here is what it deliberately does not ask for:
                        </p>
                        <ul className="mt-2.5 flex flex-wrap gap-2">
                            {NOT_REQUESTED.map((item) => (
                                <li
                                    key={item.name}
                                    className="flex items-center gap-2 rounded-lg bg-well px-2.5 py-1.5 text-xs text-fg2"
                                >
                                    <Ban className="size-3.5 flex-none text-dan" strokeWidth={1.5} />
                                    <code className="font-mono text-fg">{item.name}</code>
                                    <span>&mdash; {item.why}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </Card>
            </section>

            <section className="mx-auto mt-[84px] max-w-[1020px]">
                <Card className="flex flex-col items-start gap-4 p-[18px] md:flex-row md:items-center md:justify-between md:p-6">
                    <div>
                        <h3 className="text-base leading-[1.3] font-semibold tracking-[-0.012em]">
                            Optional: connect it to your NextMove account
                        </h3>
                        <p className="mt-2.5 max-w-[620px] text-[13px] leading-[1.65] text-fg2">
                            Pairing takes one 8-character code, valid for five minutes and usable once. The extension
                            never sees your password and never touches your browser cookies. Once paired, the
                            applications it fills show up in your Applied dashboard alongside the outreach you write
                            here &mdash; and you can revoke any device from{" "}
                            <Link href="/settings/devices" className="text-acc hover:underline">
                                Settings &rarr; Connected devices
                            </Link>{" "}
                            at any time.
                        </p>
                    </div>
                    <Link href="/applied?tab=applications" className={`${BTN_SEC} flex-none px-3.5 py-2`}>
                        See the dashboard
                        <ArrowRight className="size-3.5" strokeWidth={1.5} />
                    </Link>
                </Card>
            </section>

            <section className="mx-auto mt-[84px] max-w-[560px] text-center">
                <h2 className={H2}>Stop retyping your own name.</h2>
                <p className="mt-2.5 text-sm leading-[1.65] text-fg2">
                    Install it, spend two minutes on your profile, and get the rest of your applications back.
                </p>
                <a
                    href={CHROME_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${BTN_ACC} mt-[26px] px-[18px] py-2.5 text-sm`}
                >
                    Add NextMove Autofill to Chrome
                    <ArrowRight className="size-3.5" strokeWidth={1.5} />
                </a>
                <p className="mt-3 text-[13px] text-fg3">
                    Free. Bring your own Gemini key for AI answers, or skip AI entirely &mdash; everything else works
                    without it.
                </p>
            </section>
        </main>
    )
}
