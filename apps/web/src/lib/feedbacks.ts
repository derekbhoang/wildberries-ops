import "server-only";

import { unstable_rethrow } from "next/navigation";
import {
  feedbacksPageSchema,
  type FeedbacksPage,
} from "@wildberries-ops/contracts";

export type GetFeedbacksOptions = {
  take?: number;
  skip?: number;
};

export type FeedbacksResult =
  | { ok: true; data: FeedbacksPage }
  | {
      ok: false;
      reason: "rate-limited";
      retryAfterSeconds?: number;
    }
  | {
      ok: false;
      reason: "access-denied" | "timeout" | "unavailable" | "invalid-response";
    };

function hasCode(body: unknown, code: string): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === code
  );
}

function readRetryAfterSeconds(body: unknown): number | undefined {
  if (
    typeof body !== "object" ||
    body === null ||
    !("retryAfterSeconds" in body)
  ) {
    return undefined;
  }

  const value = body.retryAfterSeconds;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export async function getFeedbacks({
  take = 50,
  skip = 0,
}: GetFeedbacksOptions = {}): Promise<FeedbacksResult> {
  if (
    !Number.isInteger(take) ||
    take < 1 ||
    take > 100 ||
    !Number.isInteger(skip) ||
    skip < 0 ||
    skip > 199_990
  ) {
    throw new RangeError("Invalid feedback pagination");
  }

  const apiUrl = process.env.API_URL?.trim();
  if (!apiUrl) {
    throw new Error("API_URL is required");
  }

  const url = new URL("/feedbacks", apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use HTTP or HTTPS");
  }
  url.searchParams.set("take", String(take));
  url.searchParams.set("skip", String(skip));

  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
      redirect: "error",
    });
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, reason: signal.aborted ? "timeout" : "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    unstable_rethrow(error);
    if (signal.aborted || response.status === 504) {
      return { ok: false, reason: "timeout" };
    }
    return {
      ok: false,
      reason: response.ok ? "invalid-response" : "unavailable",
    };
  }

  if (!response.ok) {
    if (response.status === 502 && hasCode(body, "WB_ACCESS_DENIED")) {
      return { ok: false, reason: "access-denied" };
    }
    if (response.status === 503 && hasCode(body, "WB_RATE_LIMITED")) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterSeconds: readRetryAfterSeconds(body),
      };
    }
    return {
      ok: false,
      reason: response.status === 504 ? "timeout" : "unavailable",
    };
  }

  const parsed = feedbacksPageSchema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "invalid-response" };
}
