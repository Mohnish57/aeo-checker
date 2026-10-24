import { Loader2 } from "lucide-react";

import { SiteHeader } from "@/components/site-header";

const STEPS = [
  "Reading your page the way AI assistants do",
  "Checking which AI crawlers are allowed in",
  "Looking for structured data and trust signals",
  "Working out your score after fixes",
  "Writing fix prompts for your website builder",
];

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="bg-canvas">
        <section className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-blue" aria-hidden />
              <h1 className="text-xl font-semibold tracking-tight text-ink">
                Checking your site…
              </h1>
            </div>
            <p className="mt-2 text-sm/6 text-muted">
              This usually takes 20–40 seconds.
            </p>
            <ol role="list" className="mt-6 grid gap-3">
              {STEPS.map((step, index) => (
                <li
                  key={step}
                  className="flex items-center gap-3 text-sm text-muted [animation:1.8s_ease-in-out_infinite_pulse] [animation-delay:var(--d)]"
                  style={{ "--d": `${index * 240}ms` } as React.CSSProperties}
                >
                  <span className="size-1.5 rounded-full bg-blue/60" aria-hidden />
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-soft">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue/50" />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
