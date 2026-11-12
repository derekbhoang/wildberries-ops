import type { Metadata } from "next";
import { Suspense } from "react";
import RefreshButton from "@/components/feedbacks/refresh-button";
import ReviewsContent, {
  ReviewsSkeleton,
} from "@/components/feedbacks/reviews-content";

export const metadata: Metadata = {
  title: "Reviews | Wildberries Ops",
  description: "Manage unanswered reviews from your Wildberries store.",
};

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Unanswered reviews
        </h1>
        <RefreshButton />
      </header>

      <Suspense fallback={<ReviewsSkeleton />}>
        <ReviewsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
