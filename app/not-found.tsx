import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
        <p className="text-sm font-medium text-blue">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-3 text-[15px]/6 text-muted">
          The website checker is on the home page.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex w-fit items-center rounded-lg bg-blue px-4 py-2.5 text-[15px] font-medium text-white transition hover:bg-blue-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
        >
          Check a website
        </Link>
      </main>
    </>
  );
}
