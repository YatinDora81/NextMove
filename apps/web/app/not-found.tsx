import Link from "next/link"

export default function NotFound() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-mono text-[12.5px] tracking-[0.09em] text-fg3 uppercase">404</p>
            <h2 className="text-[26px] leading-[1.15] font-[650] tracking-[-0.022em] text-fg">
                Page not found
            </h2>
            <p className="max-w-[42ch] text-[13.5px] leading-[1.6] text-fg2">
                The page you are looking for does not exist.
            </p>
            <Link
                href="/"
                className="mt-1 text-[13.5px] font-medium text-acc hover:underline"
            >
                Return home
            </Link>
        </div>
    )
}
