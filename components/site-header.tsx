import Link from "next/link";

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b hairline bg-panel/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink"
        >
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-blue text-[11px] font-bold text-white"
          >
            AI
          </span>
          AEO Checker
        </Link>
        {children ? (
          <div className="flex items-center gap-3 text-sm text-muted">{children}</div>
        ) : null}
      </div>
    </header>
  );
}
