import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
    ArrowRight,
    BarChart3,
    Briefcase,
    CheckCircle2,
    Copy,
    Filter,
    Github,
    KeyRound,
    Linkedin,
    MessageSquare,
    Plus,
    ShieldCheck,
    Twitter,
    WifiOff,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { GridHero } from "@/components/quiet/GridHero"
import { Logo } from "@/components/quiet/Logo"
import { Chip } from "@/components/quiet/Chip"
import { Kbd } from "@/components/quiet/Kbd"
import { Card, Well } from "@/components/quiet/Card"
import { Field, Input } from "@/components/quiet/Field"
import GetStartedButton from "@/components/GetStartedButton"
import DarkImage from "../public/dark.gif"
import LightImage from "../public/light.gif"
import { BASE_API } from "../utils/url"

export const metadata: Metadata = {
    title: "NextMoveApp | AI Job Application Assistant",
    description:
        "NextMoveApp helps job seekers craft personalized applications, track progress, and collaborate with AI to land their next role faster.",
}

const CHROME_STORE_URL =
    process.env.NEXT_PUBLIC_CHROME_STORE_URL ?? "https://chromewebstore.google.com/search/NextMove%20Autofill"

const BTN =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-transparent text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
const BTN_ACC = `${BTN} bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong`
const BTN_SEC = `${BTN} border-hair2 bg-surface text-fg shadow-qsm hover:bg-well`
const OV = "text-[11px] font-medium uppercase tracking-[.09em] text-fg3"
const H2 = "text-[clamp(22px,2.6vw,30px)] font-[650] leading-[1.15] tracking-[-0.022em]"

const views: { label: string; icon: LucideIcon }[] = [
    { label: "All applications", icon: Briefcase },
    { label: "Outreach", icon: MessageSquare },
    { label: "This week", icon: BarChart3 },
]

const filters: { label: string; icon: LucideIcon }[] = [
    { label: "Interviewing", icon: Filter },
    { label: "Awaiting reply", icon: Filter },
]

const rows: {
    company: string
    role: string
    tone: "warn" | "acc" | "ok" | "mut"
    status: string
    ats: string
    updated: string
}[] = [
    { company: "Stripe", role: "Frontend Developer", tone: "warn", status: "Interview", ats: "Greenhouse", updated: "Today, 9:14" },
    { company: "Razorpay", role: "SDE II", tone: "acc", status: "Applied", ats: "Lever", updated: "Yesterday" },
    { company: "Zerodha", role: "Full Stack Developer", tone: "ok", status: "Offer", ats: "Workday", updated: "Aug 4" },
    { company: "Atlassian", role: "Frontend Engineer", tone: "mut", status: "Closed", ats: "Workday", updated: "Jul 30" },
]

const boards = ["Greenhouse", "Lever", "Workday", "Ashby", "SmartRecruiters", "iCIMS"]

const autofillClaims = [
    "22 fields on a Greenhouse form, filled in 1.2s",
    "Learned answers reused across every ATS",
    "The submit button is never pressed for you",
]

const privacyPoints: { icon: LucideIcon; title: string; body: string }[] = [
    {
        icon: ShieldCheck,
        title: "Never auto-submits",
        body: "It fills and highlights. You review. You press submit. Every time.",
    },
    {
        icon: KeyRound,
        title: "Keys stay local",
        body: "Your Gemini key is encrypted on-device and never reaches our servers.",
    },
    {
        icon: WifiOff,
        title: "Works offline",
        body: "Guest mode is fully local. Sync to an account only if you want it.",
    },
]

export default function LandingPage() {
    void fetch(BASE_API).catch(() => {})

    return (
        <main className="min-h-screen bg-bg font-sans text-fg">
            <GridHero gridHeight={700}>
                <div className="px-6">
                    <section className="mx-auto max-w-[660px] pt-[72px] text-center">
                        <div className={OV}>Job applications, automated</div>
                        <h1 className="mt-3.5 text-[clamp(34px,4.6vw,52px)] font-[650] leading-[1.08] tracking-[-0.028em] max-md:text-[34px]">
                            Apply to every job.
                            <br />
                            Type your name once.
                        </h1>
                        <p className="mx-auto mt-[18px] max-w-[520px] text-base leading-[1.6] text-fg2">
                            NextMove fills any application form in one click, drafts outreach recruiters answer, and
                            keeps every application tracked &mdash; encrypted in your browser.
                        </p>
                        <div className="mt-[26px] flex flex-wrap justify-center gap-2.5">
                            <a
                                href={CHROME_STORE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${BTN_ACC} px-[18px] py-2.5 text-sm`}
                            >
                                Add to Chrome
                                <span className="font-normal opacity-[.55]">&mdash; it&apos;s free</span>
                            </a>
                            <GetStartedButton variant="outline" className={`${BTN_SEC} h-auto px-[18px] py-2.5 text-sm`}>
                                <span>Try the web app</span>
                            </GetStartedButton>
                        </div>
                        <div className="mt-3.5 text-[13px] text-fg3">
                            Free forever &middot; No card &middot; Nothing auto-submits
                        </div>
                    </section>

                    <section className="mx-auto mt-[52px] max-w-[1120px]">
                        <Card className="overflow-hidden border-hair2 shadow-qmd">
                            <div className="flex items-center gap-2.5 border-b border-hair bg-surface px-4 py-2.5">
                                <Logo size={24} />
                                <span className="text-sm font-semibold tracking-[-0.01em]">NextMove</span>
                                <nav className="ml-3.5 flex gap-0.5 max-md:hidden">
                                    {["Generate", "Templates", "Applied", "AI Chat"].map((label) => (
                                        <span
                                            key={label}
                                            className={
                                                label === "Applied"
                                                    ? "rounded-lg bg-well px-2.5 py-1.5 text-[13px] font-medium text-fg"
                                                    : "rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-fg2"
                                            }
                                        >
                                            {label}
                                        </span>
                                    ))}
                                </nav>
                                <span className="ml-auto flex min-w-[180px] items-center gap-2 rounded-lg bg-well px-2.5 py-1.5 text-[13px] text-fg3 max-md:hidden">
                                    Search
                                    <span className="ml-auto">
                                        <Kbd>&#8984;K</Kbd>
                                    </span>
                                </span>
                                <span className="flex size-7 flex-none items-center justify-center rounded-full bg-well2 text-xs font-semibold text-fg2 max-md:ml-auto">
                                    Y
                                </span>
                            </div>

                            <div className="flex min-h-[330px]">
                                <aside className="flex w-[190px] flex-none flex-col gap-0.5 bg-well px-2.5 py-3.5 max-md:hidden">
                                    <div className="px-3 pb-2 text-[11px] font-medium tracking-[.08em] text-fg3 uppercase">
                                        Views
                                    </div>
                                    {views.map((view, index) => (
                                        <span
                                            key={view.label}
                                            className={
                                                index === 0
                                                    ? "flex items-center gap-2.5 rounded-lg bg-surface px-3 py-1.5 text-[13.5px] font-medium text-fg shadow-qsm"
                                                    : "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-fg2"
                                            }
                                        >
                                            <view.icon
                                                className={index === 0 ? "size-4 flex-none text-acc" : "size-4 flex-none"}
                                                strokeWidth={1.5}
                                            />
                                            {view.label}
                                        </span>
                                    ))}
                                    <div className="mt-3.5 px-3 pb-2 text-[11px] font-medium tracking-[.08em] text-fg3 uppercase">
                                        Filters
                                    </div>
                                    {filters.map((filter) => (
                                        <span
                                            key={filter.label}
                                            className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-fg2"
                                        >
                                            <filter.icon className="size-4 flex-none" strokeWidth={1.5} />
                                            {filter.label}
                                        </span>
                                    ))}
                                </aside>

                                <div className="min-w-0 flex-1 bg-surface">
                                    <div className="flex items-center gap-2.5 border-b border-hair px-4 py-3">
                                        <span className="text-[15px] font-semibold">Applications</span>
                                        <Chip dot={false} className="tnum">
                                            26
                                        </Chip>
                                        <span className="ml-auto flex items-center gap-1.5 text-[13px] text-fg2 max-lg:hidden">
                                            <span className="size-1.5 rounded-full bg-ok" />
                                            Synced from Chrome &middot; MacBook &middot; 2m ago
                                        </span>
                                        <span
                                            className={`${BTN_ACC} px-2.5 py-1.5 text-[12.5px] max-lg:ml-auto`}
                                        >
                                            <Plus className="size-[13px]" strokeWidth={1.5} />
                                            Add
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[620px] border-collapse text-[13.5px]">
                                            <thead>
                                                <tr>
                                                    {["Company", "Role", "Status", "ATS", "Updated"].map((head) => (
                                                        <th
                                                            key={head}
                                                            className="border-b border-hair px-3.5 py-2.5 text-left text-xs font-medium text-fg3"
                                                        >
                                                            {head}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((row) => (
                                                    <tr key={row.company} className="hover:bg-well">
                                                        <td className="border-t border-hair px-3.5 py-2.5 font-semibold">
                                                            {row.company}
                                                        </td>
                                                        <td className="border-t border-hair px-3.5 py-2.5">{row.role}</td>
                                                        <td className="border-t border-hair px-3.5 py-2.5">
                                                            <Chip tone={row.tone}>{row.status}</Chip>
                                                        </td>
                                                        <td className="border-t border-hair px-3.5 py-2.5 text-[13px] text-fg2">
                                                            {row.ats}
                                                        </td>
                                                        <td className="tnum border-t border-hair px-3.5 py-2.5 text-[13px] text-fg2">
                                                            {row.updated}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <div className="mt-11 flex flex-wrap items-center justify-center gap-x-[34px] gap-y-3 text-[13.5px] font-semibold tracking-[.01em] text-fg3">
                            <span className="text-[13px] font-normal">Fills applications on</span>
                            {boards.map((board) => (
                                <span key={board} className={board === "iCIMS" ? "max-md:hidden" : undefined}>
                                    {board}
                                </span>
                            ))}
                        </div>
                    </section>

                    <section className="mx-auto mt-[84px] max-w-[960px]">
                        <div className={`${OV} text-center`}>Recorded in the app</div>
                        <Card className="mt-3.5 overflow-hidden border-hair2 shadow-qmd">
                            <div className="flex items-center gap-2 border-b border-hair bg-well px-3.5 py-2.5">
                                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                                <span className="size-2.5 rounded-full bg-[#28c840]" />
                                <span className="ml-3 truncate rounded-lg border border-hair bg-surface px-2.5 py-[3px] font-mono text-[11.5px] text-fg3">
                                    nextmove-yatin.vercel.app/generate
                                </span>
                            </div>
                            <Image
                                src={DarkImage}
                                alt="NextMove generating an outreach message"
                                className="hidden h-auto w-full dark:block"
                            />
                            <Image
                                src={LightImage}
                                alt="NextMove generating an outreach message"
                                className="block h-auto w-full dark:hidden"
                            />
                        </Card>
                    </section>

                    <div className="mx-auto max-w-[1020px] pb-[76px]">
                        <section id="product" className="mt-[84px] scroll-mt-20">
                            <div className="grid items-center gap-11 md:grid-cols-[1fr_1.15fr]">
                                <div>
                                    <div className={OV}>01 &middot; Autofill</div>
                                    <h2 className={`mt-2.5 ${H2}`}>One click fills the whole form.</h2>
                                    <p className="mt-2.5 text-sm leading-[1.65] text-fg2">
                                        Confident answers fill instantly. Uncertain ones become suggestions you approve.
                                        Personal questions are left for you &mdash; always. Press <Kbd>&#8984;</Kbd>{" "}
                                        <Kbd>&#8629;</Kbd> on any job page.
                                    </p>
                                    <div className="mt-4 flex flex-col gap-2.5">
                                        {autofillClaims.map((claim) => (
                                            <div key={claim} className="flex items-center gap-2.5 text-[13.5px]">
                                                <CheckCircle2 className="size-4 flex-none text-ok" strokeWidth={1.5} />
                                                {claim}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Card className="px-5 py-[18px]">
                                    <div className="flex items-center gap-2">
                                        <span className={`${OV} text-[10.5px]`}>boards.greenhouse.io</span>
                                        <Chip dot={false} className="ml-auto text-[11.5px]">
                                            22 fields found
                                        </Chip>
                                    </div>
                                    <Field label="First name">
                                        <div className="relative">
                                            <Input defaultValue="Yatin" readOnly />
                                            <CheckCircle2
                                                className="absolute top-[11px] right-2.5 size-4 text-ok"
                                                strokeWidth={1.5}
                                            />
                                        </div>
                                    </Field>
                                    <Field label="Years of React experience">
                                        <Input readOnly />
                                        <Well className="mt-2 flex flex-wrap items-center gap-2.5 px-2.5 py-2 text-[13px]">
                                            <Chip tone="warn" dot={false} className="text-[11.5px]">
                                                Suggested
                                            </Chip>
                                            <b>5</b>
                                            <span className={`${BTN_ACC} ml-auto px-2.5 py-1 text-xs`}>Accept</span>
                                            <span className={`${BTN} px-2 py-1 text-xs text-fg2`}>Edit</span>
                                        </Well>
                                    </Field>
                                    <Field label="Why do you want to work here?" hint="left for you">
                                        <textarea
                                            rows={2}
                                            readOnly
                                            className="w-full resize-none rounded-lg border border-dashed border-hair2 bg-surface px-3 py-2 text-[13.5px] text-fg"
                                        />
                                    </Field>
                                </Card>
                            </div>
                        </section>

                        <section className="mt-[76px]">
                            <div className="grid items-center gap-11 md:grid-cols-[1.15fr_1fr]">
                                <Card className="overflow-hidden">
                                    <div className="flex items-center gap-2 border-b border-hair px-4 py-[11px]">
                                        <span className="text-sm font-semibold">Outreach</span>
                                        <Chip dot={false} className="ml-auto text-[11.5px]">
                                            Draft &middot; Gemini &middot; 0.8s
                                        </Chip>
                                    </div>
                                    <div className="px-[18px] py-4 text-[13.5px] leading-[1.75] text-fg">
                                        <p>Hi Sarah,</p>
                                        <p className="mt-4">
                                            I came across the Frontend Developer opening at Stripe and it lines up
                                            closely with what I&apos;ve been building &mdash; five years of React and
                                            TypeScript, most recently leading a design-system migration across three
                                            product teams.
                                        </p>
                                        <p className="mt-4">I&apos;d love to be considered.</p>
                                    </div>
                                    <div className="flex items-center gap-2 border-t border-hair px-4 py-3">
                                        <span className={`${BTN_SEC} px-3 py-1.5 text-[12.5px]`}>
                                            <Copy className="size-[13px]" strokeWidth={1.5} />
                                            Copy
                                        </span>
                                        <span className={`${BTN} px-3 py-1.5 text-[12.5px] text-fg2`}>Regenerate</span>
                                        <span className="tnum ml-auto text-xs text-fg2">184 words</span>
                                    </div>
                                </Card>

                                <div>
                                    <div className={OV}>02 &middot; Outreach</div>
                                    <h2 className={`mt-2.5 ${H2}`}>Messages that sound like you wrote them.</h2>
                                    <p className="mt-2.5 text-sm leading-[1.65] text-fg2">
                                        Templates plus your profile plus the job details. Generated on your own Gemini
                                        key, saved to your history, one tap to copy. No credits, no middleman.
                                    </p>
                                    <Link
                                        href="/templates"
                                        className="mt-3 inline-block text-[13.5px] text-acc hover:underline"
                                    >
                                        Browse the template library &rarr;
                                    </Link>
                                </div>
                            </div>
                        </section>

                        <section id="privacy" className="mt-[84px] scroll-mt-20">
                            <div className="mx-auto max-w-[520px] text-center">
                                <div className={OV}>03 &middot; Private by default</div>
                                <h2 className={`mt-2.5 ${H2}`}>Your data has one home: your device.</h2>
                            </div>
                            <div className="mx-auto mt-[26px] grid max-w-[960px] gap-3.5 md:grid-cols-3">
                                {privacyPoints.map((point) => (
                                    <Card key={point.title} className="p-[18px]">
                                        <point.icon className="size-4 text-fg2" strokeWidth={1.5} />
                                        <h3 className="mt-2.5 text-base leading-[1.3] font-semibold tracking-[-0.012em]">
                                            {point.title}
                                        </h3>
                                        <p className="mt-[5px] text-[13px] text-fg2">{point.body}</p>
                                    </Card>
                                ))}
                            </div>
                            <div className="mt-14 text-center">
                                <a
                                    href={CHROME_STORE_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`${BTN_ACC} px-[18px] py-2.5 text-sm`}
                                >
                                    Add to Chrome
                                    <ArrowRight className="size-3.5" strokeWidth={1.5} />
                                </a>
                                <div className="mt-3 text-[13px] text-fg3">
                                    Set up in 2 minutes &middot; works signed out
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </GridHero>

            <footer className="border-t border-hair px-6 py-8">
                <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-4">
                    <Logo size={22} />
                    <span className="text-[13px] text-fg2">
                        &copy; {new Date().getFullYear()} NextMoveApp
                    </span>
                    <Link href="/extension" className="text-[13px] text-fg2 hover:text-fg">
                        Extension
                    </Link>
                    <div className="ml-auto flex items-center gap-1">
                        {[
                            { href: "https://x.com/YatinDora", label: "X", icon: Twitter },
                            { href: "https://www.linkedin.com/in/yatin-dora/", label: "LinkedIn", icon: Linkedin },
                            { href: "https://github.com/YatinDora81", label: "GitHub", icon: Github },
                        ].map((social) => (
                            <a
                                key={social.href}
                                href={social.href}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={social.label}
                                className="rounded-lg p-1.5 text-fg3 transition-colors hover:bg-well hover:text-fg"
                            >
                                <social.icon className="size-4" strokeWidth={1.5} />
                            </a>
                        ))}
                    </div>
                </div>
            </footer>
        </main>
    )
}
