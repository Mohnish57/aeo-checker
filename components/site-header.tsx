import Link from "next/link";

/** Check mark with an AI sparkle; same drawing as public/logo.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="#0C66E4" />
      <path
        d="M7.5 17.5l5 5 8.5-9.5"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24.5 3.8c.45 2.3 1.6 3.45 3.9 3.9-2.3.45-3.45 1.6-3.9 3.9-.45-2.3-1.6-3.45-3.9-3.9 2.3-.45 3.45-1.6 3.9-3.9z"
        fill="#F5CD47"
      />
    </svg>
  );
}

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b hairline bg-panel/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink"
        >
          <LogoMark className="size-7" />
          AEO Checker
        </Link>
        {children ? (
          <div className="flex items-center gap-3 text-sm text-muted">{children}</div>
        ) : null}
      </div>
    </header>
  );
}
