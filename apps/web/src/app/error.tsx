"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

type ErrorPageProps = {
  error: unknown;
  retry: () => void;
};

export default function ErrorPage({ retry }: ErrorPageProps) {
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    if (isPending) return;
    startTransition(() => retry());
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <section
        role="alert"
        aria-labelledby="page-error-title"
        className="space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground"
      >
        <h1
          id="page-error-title"
          className="text-xl font-semibold tracking-tight"
        >
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground">
          We couldn’t load this page. Please try again.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={handleRetry}
          disabled={isPending}
          aria-busy={isPending}
        >
          <RefreshCw
            aria-hidden="true"
            className={isPending ? "motion-safe:animate-spin" : undefined}
          />
          {isPending ? "Retrying…" : "Try again"}
        </Button>
      </section>
    </main>
  );
}
