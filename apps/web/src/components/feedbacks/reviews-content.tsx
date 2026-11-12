import "server-only";

import type { Feedback } from "@wildberries-ops/contracts";
import Link from "next/link";
import { Suspense } from "react";
import { getFeedbacks, type FeedbacksResult } from "@/lib/feedbacks";

const PAGE_SIZE = 50;
const MAX_PAGE = Math.floor(199_990 / PAGE_SIZE) + 1;
const linkClassName =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeZone: "Australia/Sydney",
});

type SearchParams = Record<string, string | string[] | undefined>;
type FeedbacksFailure = Extract<FeedbacksResult, { ok: false }>;

function pageHref(page: number): string {
  return page === 1 ? "/" : `/?page=${page}`;
}

function parsePage(value: SearchParams[string]): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE
    ? page
    : null;
}

function ReviewCard({ review }: { review: Feedback }) {
  const product = review.productDetails;
  const name =
    product?.productName?.trim() ||
    (product ? `Product ${product.nmId}` : "Unknown product");
  const text = review.text?.trim();
  const pros = review.pros?.trim();
  const cons = review.cons?.trim();
  const createdDate = new Date(review.createdDate);
  const hasDate = !Number.isNaN(createdDate.getTime());
  const rating = review.productValuation;
  const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 5;

  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="break-words font-semibold">{name}</h2>
          {product && (
            <p className="text-xs text-muted-foreground">WB {product.nmId}</p>
          )}
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-sm font-medium">
          {hasRating ? `${rating} / 5` : "Rating unavailable"}
        </span>
      </header>

      {text && (
        <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
      )}
      {(pros || cons) && (
        <dl className="space-y-3 text-sm">
          {pros && (
            <div>
              <dt className="font-medium">Pros</dt>
              <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                {pros}
              </dd>
            </div>
          )}
          {cons && (
            <div>
              <dt className="font-medium">Cons</dt>
              <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                {cons}
              </dd>
            </div>
          )}
        </dl>
      )}
      {!text && !pros && !cons && (
        <p className="text-sm text-muted-foreground">No written review.</p>
      )}

      <footer className="text-xs text-muted-foreground">
        {hasDate ? (
          <time dateTime={createdDate.toISOString()}>
            {dateFormatter.format(createdDate)}
          </time>
        ) : (
          "Date unavailable"
        )}
      </footer>
    </article>
  );
}

function ReviewsFailure({
  failure,
  page,
}: {
  failure: FeedbacksFailure;
  page: number;
}) {
  const messages: Record<FeedbacksFailure["reason"], string> = {
    "access-denied": "Check your seller connection and API key permissions.",
    "rate-limited": "Wildberries has temporarily limited requests.",
    timeout: "Loading reviews took too long. Please try again.",
    unavailable: "Reviews are temporarily unavailable. Please try again.",
    "invalid-response": "We could not read the review data. Please try again.",
  };
  const canRetry =
    failure.reason !== "rate-limited" || failure.retryAfterSeconds === 0;

  return (
    <section
      role="alert"
      className="space-y-3 rounded-xl border border-border p-6"
    >
      <h2 className="font-semibold">Couldn’t load reviews</h2>
      <p className="text-sm text-muted-foreground">
        {messages[failure.reason]}
      </p>
      {failure.reason === "rate-limited" && !canRetry && (
        <p className="text-sm text-muted-foreground">
          {failure.retryAfterSeconds !== undefined
            ? `Wait ${failure.retryAfterSeconds.toLocaleString("en-AU")} seconds, then refresh this page.`
            : "Wait a moment, then refresh this page."}
        </p>
      )}
      {canRetry && failure.reason !== "access-denied" && (
        <a className={linkClassName} href={pageHref(page)}>
          Try again
        </a>
      )}
    </section>
  );
}

async function ReviewResults({ page }: { page: number }) {
  const result = await getFeedbacks({
    take: PAGE_SIZE + 1,
    skip: (page - 1) * PAGE_SIZE,
  });
  if (!result.ok) return <ReviewsFailure failure={result} page={page} />;

  const reviews = result.data.feedbacks.slice(0, PAGE_SIZE);
  const hasNext = result.data.feedbacks.length > PAGE_SIZE && page < MAX_PAGE;

  return (
    <section aria-label="Review results" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">
            {result.data.countUnanswered.toLocaleString("en-AU")}
          </span>{" "}
          unanswered reviews
        </p>
        <p>Dates shown in Sydney time</p>
      </div>

      {reviews.length > 0 ? (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewCard review={review} />
            </li>
          ))}
        </ul>
      ) : (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-dashed p-8 text-center"
        >
          <h2 className="font-semibold">
            {page === 1 ? "No unanswered reviews" : "No reviews on this page"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {page === 1
              ? "New reviews will appear here when they arrive."
              : "Reviews may have changed since your last visit."}
          </p>
          {page > 1 && (
            <Link className={linkClassName} href="/" prefetch={false}>
              Go to first page
            </Link>
          )}
        </div>
      )}

      <nav
        aria-label="Reviews pagination"
        className="flex items-center justify-between gap-3"
      >
        {page > 1 ? (
          <Link
            className={linkClassName}
            href={pageHref(page - 1)}
            prefetch={false}
          >
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={`${linkClassName} pointer-events-none opacity-50`}
          >
            Previous
          </span>
        )}
        <span aria-current="page" className="text-sm text-muted-foreground">
          Page {page.toLocaleString("en-AU")}
        </span>
        {hasNext ? (
          <Link
            className={linkClassName}
            href={pageHref(page + 1)}
            prefetch={false}
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={`${linkClassName} pointer-events-none opacity-50`}
          >
            Next
          </span>
        )}
      </nav>
    </section>
  );
}

export function ReviewsSkeleton() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading reviews…</span>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="space-y-4 rounded-xl border border-border p-6"
          >
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ReviewsContent({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const page = parsePage((await searchParams).page);
  if (page === null) {
    return (
      <section
        role="alert"
        className="space-y-4 rounded-xl border border-border p-6"
      >
        <h2 className="font-semibold">This review page isn’t available</h2>
        <Link className={linkClassName} href="/" prefetch={false}>
          Go to first page
        </Link>
      </section>
    );
  }

  return (
    <Suspense key={page} fallback={<ReviewsSkeleton />}>
      <ReviewResults page={page} />
    </Suspense>
  );
}
