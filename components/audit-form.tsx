"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { auditHref, normalizeAuditUrl } from "@/lib/url";

const EXAMPLES = ["linear.app", "stripe.com", "notion.so"];

type AuditFormProps = {
  initialDomain?: string;
};

export function AuditForm({ initialDomain = "" }: AuditFormProps) {
  const [value, setValue] = useState(initialDomain);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function goToAudit(target: string) {
    const trimmed = target.trim();
    if (!trimmed) {
      setError("Enter your website address.");
      return;
    }

    const auditUrl = normalizeAuditUrl(trimmed);
    if (!auditUrl) {
      setError("That doesn't look like a website address. Try example.com.");
      return;
    }

    setError("");
    const href = auditHref(auditUrl);
    startTransition(() => {
      router.push(href as never);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goToAudit(value);
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="flex flex-col gap-2 rounded-2xl border hairline bg-panel p-2 shadow-[0_1px_2px_rgb(9_30_66/0.08)] focus-within:border-blue focus-within:ring-4 focus-within:ring-blue/15 sm:flex-row">
        <input
          aria-label="Website address to check"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="yourcompany.com"
          className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-3 text-lg text-ink placeholder:text-subtle/70 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue px-5 py-3 text-[15px] font-medium text-white transition hover:bg-blue-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {isPending ? "Checking…" : "Check my site"}
          {isPending ? null : <ArrowRight className="size-4" />}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-subtle">
        <span>Try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setValue(example);
              goToAudit(example);
            }}
            className="rounded-full border hairline bg-panel px-3 py-1 text-muted transition hover:border-blue hover:text-blue"
          >
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}
