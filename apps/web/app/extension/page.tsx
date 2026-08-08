import type { Metadata } from "next"
import Link from "next/link"
import {
    AlarmClock,
    ArrowRight,
    Ban,
    Chrome,
    CircleSlash,
    Cpu,
    Download,
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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * JF-001 SEC 8.5 — `/extension`, the public install page. Ships with the Chrome Web Store
 * launch (V1), so it must render for a signed-out visitor: nothing on this page reads a
 * token, and `/extension` is deliberately absent from the protected list in middleware.ts.
 *
 * Its job is to tell the SEC 09 privacy story and to justify, in plain English, every
 * permission in the SEC 10 manifest — above all the content script's `<all_urls>` match,
 * which is the one thing that makes a careful person hesitate. The Chrome Web Store review
 * narrative and this page say the same sentence: "fill job application forms you are
 * viewing" — no auto-submit, no scraping at scale, no remote code.
 */

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

/**
 * The store listing URL. Overridable per-environment so the staging build can point at an
 * unlisted item; the fallback is the store's own search for the published listing name,
 * which resolves for a visitor even before the direct item id is minted.
 */
const CHROME_STORE_URL =
    process.env.NEXT_PUBLIC_CHROME_STORE_URL ?? "https://chromewebstore.google.com/search/NextMove%20Autofill"

const HERO_CHIPS: string[] = [
    "Works on any career page",
    "Never auto-submits",
    "Your data stays on your device",
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

function SectionHeading({
    eyebrow,
    title,
    body,
}: {
    eyebrow: string
    title: string
    body: string
}) {
    return (
        <div className="flex flex-col items-center gap-3 text-center">
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
                {eyebrow}
            </span>
            <h2 className="max-w-3xl text-2xl font-bold md:text-4xl">{title}</h2>
            <p className="max-w-2xl text-sm text-zinc-600 md:text-base dark:text-zinc-400">{body}</p>
        </div>
    )
}

export default function ExtensionPage() {
    return (
        <div className="flex w-full flex-col items-center gap-20 pb-24">
            {/* ---------------- Hero ---------------- */}
            <section className="relative flex w-full flex-col items-center overflow-hidden px-4 pt-[12vh] pb-12">
                <div
                    className={cn(
                        "absolute inset-0 z-0",
                        "[background-size:40px_40px]",
                        "[background-image:linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]",
                        "dark:[background-image:linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]",
                    )}
                    aria-hidden="true"
                />
                <div
                    className="pointer-events-none absolute inset-0 z-0 bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_5%,black_80%)]"
                    aria-hidden="true"
                />

                <div className="z-10 flex max-w-3xl flex-col items-center gap-6 text-center">
                    <div className="flex items-center gap-2 rounded-3xl border border-zinc-200 bg-zinc-100/70 px-4 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <Chrome className="h-4 w-4" aria-hidden="true" />
                        <span className="text-xs font-medium sm:text-sm">Chrome extension &middot; NextMove Autofill</span>
                    </div>

                    <h1 className="text-4xl font-bold poppins-bold md:text-6xl">
                        Fill any job application in one click
                    </h1>

                    <p className="max-w-2xl text-base text-zinc-600 md:text-xl dark:text-zinc-300">
                        Greenhouse, Lever, Workday, Ashby, iCIMS &mdash; and the long tail of career pages that use
                        none of them. Your data stays on your device, and nothing is ever submitted for you.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2">
                        {HERO_CHIPS.map((chip) => (
                            <span
                                key={chip}
                                className="rounded-3xl border border-black/40 bg-white px-3 py-1.5 text-xs font-medium dark:border-gray-200/30 dark:bg-zinc-950/60"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>

                    <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
                        <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
                            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4" />
                                Add to Chrome &mdash; free
                            </a>
                        </Button>
                        <Button asChild size="lg" variant="outline" className="w-full gap-2 sm:w-auto">
                            <a href="#permissions">
                                What it can access
                                <ArrowRight className="h-4 w-4" />
                            </a>
                        </Button>
                    </div>

                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                        Chrome 116+. No account required to use it &mdash; sign in only if you want your tracker to
                        follow you between machines.
                    </p>
                </div>
            </section>

            {/* ---------------- Demo ---------------- */}
            <section className="w-full max-w-5xl px-4">
                <div className="rounded-2xl border border-zinc-200 shadow-2xl shadow-zinc-500/10 dark:border-zinc-800">
                    <div className="flex h-9 items-center gap-2 rounded-t-2xl bg-zinc-100 pl-4 dark:bg-zinc-900">
                        <span className="h-3 w-3 rounded-full bg-red-500" aria-hidden="true" />
                        <span className="h-3 w-3 rounded-full bg-yellow-500" aria-hidden="true" />
                        <span className="h-3 w-3 rounded-full bg-green-500" aria-hidden="true" />
                        <span className="ml-3 truncate text-xs text-zinc-500">boards.greenhouse.io/acme/jobs/…</span>
                    </div>

                    {/*
                        Demo GIF slot. When the recording exists, drop it at
                        `apps/web/public/extension/demo.gif` and replace this placeholder with a
                        next/image <Image src="/extension/demo.gif" … unoptimized /> — the surrounding
                        aspect box is already sized for a 16:9 capture. No asset is invented here on
                        purpose: a fabricated screenshot on an install page is a store-policy problem.
                    */}
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-b-2xl bg-[linear-gradient(45deg,transparent_46%,rgba(113,113,122,0.18)_46%,rgba(113,113,122,0.18)_54%,transparent_54%)] bg-[length:14px_14px] px-6 text-center">
                        <div className="rounded-xl bg-white/85 p-3 shadow-sm dark:bg-zinc-900/85">
                            <MousePointerClick className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <p className="max-w-md rounded-lg bg-white/85 px-4 py-2 text-sm font-medium backdrop-blur dark:bg-zinc-900/85">
                            Demo: 26 fields on a Greenhouse application, filled and highlighted in about two
                            seconds &mdash; then handed back to you to submit.
                        </p>
                    </div>
                </div>
            </section>

            {/* ---------------- How it works ---------------- */}
            <section className="flex w-full max-w-5xl flex-col items-center gap-10 px-4">
                <SectionHeading
                    eyebrow="How it works"
                    title="Three steps, and the last one is still yours"
                    body="The extension does the typing. The decision to apply stays where it belongs."
                />

                <ol className="grid w-full gap-5 md:grid-cols-3">
                    {STEPS.map((step, index) => (
                        <li
                            key={step.title}
                            className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                            <div className="flex items-center gap-3">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                                    {index + 1}
                                </span>
                                <step.icon className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                            </div>
                            <h3 className="text-lg font-semibold">{step.title}</h3>
                            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>
                        </li>
                    ))}
                </ol>
            </section>

            {/* ---------------- Privacy ---------------- */}
            <section className="flex w-full max-w-5xl flex-col items-center gap-10 px-4">
                <SectionHeading
                    eyebrow="Local-first"
                    title="The data never has to go anywhere"
                    body="Autofill tools usually work by uploading your life to a server. This one does not need to, so it does not."
                />

                <div className="grid w-full gap-5 md:grid-cols-2">
                    {PRIVACY_POINTS.map((point) => (
                        <div
                            key={point.title}
                            className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                            <div className="flex items-center gap-3">
                                <span className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                                    <point.icon className="h-4 w-4" aria-hidden="true" />
                                </span>
                                <h3 className="text-base font-semibold">{point.title}</h3>
                            </div>
                            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{point.body}</p>
                        </div>
                    ))}
                </div>

                <div className="w-full rounded-2xl border border-amber-300 bg-amber-50/70 p-6 dark:border-amber-900 dark:bg-amber-950/30">
                    <h3 className="mb-2 text-base font-semibold text-amber-900 dark:text-amber-200">
                        The honest limit of &ldquo;encrypted at rest&rdquo;
                    </h3>
                    <p className="text-sm leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                        The encryption key is derived from a secret that lives on the same device as the data. That
                        genuinely protects you from someone reading files off the disk or lifting an unencrypted
                        browser backup. It does <strong>not</strong> protect you from malware already running as you
                        &mdash; nothing that runs in your own browser can. If you want the stronger guarantee, turn on
                        passphrase mode: the vault is then locked with something only you know, and it is what
                        cross-device sync uses so that our servers hold ciphertext they cannot read.
                    </p>
                </div>
            </section>

            {/* ---------------- Permissions ---------------- */}
            <section id="permissions" className="flex w-full max-w-5xl scroll-mt-24 flex-col items-center gap-10 px-4">
                <SectionHeading
                    eyebrow="Permissions"
                    title="Every permission, in plain English"
                    body="Chrome shows you a list at install time. Here is what each item on that list is actually for."
                />

                <div className="grid w-full gap-4 md:grid-cols-2">
                    {PERMISSIONS.map((permission) => (
                        <div
                            key={permission.name}
                            className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <permission.icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">
                                    {permission.name}
                                </code>
                                <span className="text-sm font-semibold">{permission.label}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {permission.body}
                            </p>
                        </div>
                    ))}
                </div>

                {/* The single scary permission gets its own, unhurried explanation. */}
                <div className="w-full rounded-2xl border-2 border-zinc-300 bg-white p-6 md:p-8 dark:border-zinc-700 dark:bg-zinc-900/60">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Globe className="h-5 w-5" aria-hidden="true" />
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm dark:bg-zinc-800">
                            {"<all_urls>"}
                        </code>
                        <h3 className="text-lg font-semibold">
                            &ldquo;Read and change all your data on all websites&rdquo;
                        </h3>
                    </div>

                    <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        <p>
                            This is the scary one, and it is worth being precise about. A job application can live on
                            literally any domain: a Greenhouse board, a Lever page, a company&rsquo;s own Workday
                            tenant, or a twelve-person startup&rsquo;s hand-built <code>/careers</code> form. Chrome
                            has no &ldquo;run on career pages&rdquo; permission, so an extension that works everywhere
                            has to ask for everywhere.
                        </p>
                        <p>
                            <strong className="text-zinc-900 dark:text-zinc-100">What it actually does:</strong> on
                            each page the script starts, looks for application-shaped fields, and if it finds none it
                            stops and stores nothing. No page content, URL, or browsing history is recorded or
                            transmitted for pages that are not applications &mdash; and none of it is transmitted for
                            the ones that are, either, unless you turn on sync.
                        </p>
                        <p>
                            <strong className="text-zinc-900 dark:text-zinc-100">
                                What it never does:
                            </strong>{" "}
                            no analytics on your browsing, no injected affiliate links, no scraping listings in bulk,
                            no remotely loaded code. The store listing declares a single purpose &mdash; fill job
                            application forms you are viewing &mdash; and everything in the build conforms to that
                            sentence.
                        </p>
                    </div>

                    <div className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
                        <p className="mb-3 text-sm font-semibold">And here is what it deliberately does not ask for:</p>
                        <ul className="flex flex-wrap gap-2">
                            {NOT_REQUESTED.map((item) => (
                                <li
                                    key={item.name}
                                    className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800"
                                >
                                    <Ban className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                                    <code className="font-mono">{item.name}</code>
                                    <span className="text-zinc-500 dark:text-zinc-400">&mdash; {item.why}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>

            {/* ---------------- Sync (optional) ---------------- */}
            <section className="w-full max-w-5xl px-4">
                <div className="flex flex-col items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-6 md:flex-row md:items-center md:justify-between md:p-8 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="flex flex-col gap-2">
                        <h3 className="text-lg font-semibold">Optional: connect it to your NextMove account</h3>
                        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                            Pairing takes one 8-character code, valid for five minutes and usable once. The extension
                            never sees your password and never touches your browser cookies. Once paired, the
                            applications it fills show up in your Applied dashboard alongside the outreach you write
                            here &mdash; and you can revoke any device from{" "}
                            <Link
                                href="/settings/devices"
                                className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                            >
                                Settings &rarr; Connected devices
                            </Link>{" "}
                            at any time.
                        </p>
                    </div>
                    <Button asChild variant="outline" className="w-full gap-2 md:w-auto">
                        <Link href="/applied?tab=applications">
                            See the dashboard
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </section>

            {/* ---------------- Final CTA ---------------- */}
            <section className="flex w-full max-w-3xl flex-col items-center gap-5 px-4 text-center">
                <h2 className="text-2xl font-bold md:text-4xl">Stop retyping your own name</h2>
                <p className="text-sm text-zinc-600 md:text-base dark:text-zinc-400">
                    Install it, spend two minutes on your profile, and get the rest of your applications back.
                </p>
                <Button asChild size="lg" className="gap-2">
                    <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
                        <Chrome className="h-4 w-4" />
                        Add NextMove Autofill to Chrome
                    </a>
                </Button>
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    Free. Bring your own Gemini key for AI answers, or skip AI entirely &mdash; everything else works
                    without it.
                </p>
            </section>
        </div>
    )
}
