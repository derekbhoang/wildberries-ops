"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

type RefreshButtonProps = {
  className?: string;
  disabled?: boolean;
};

export default function RefreshButton({
  className,
  disabled = false,
}: RefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    if (disabled || isPending) return;
    startTransition(() => router.refresh());
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      disabled={disabled || isPending}
      aria-busy={isPending}
      onClick={handleRefresh}
    >
      <RefreshCw
        aria-hidden="true"
        className={isPending ? "motion-safe:animate-spin" : undefined}
      />
      {isPending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
