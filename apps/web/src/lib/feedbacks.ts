import "server-only";

import { unstable_rethrow } from "next/navigation";
import {
  feedbackAnswerSchema,
  feedbackAnswerStatusSchema,
  feedbackDraftSchema,
  feedbackIdSchema,
  feedbacksPageSchema,
  type FeedbackAnswerResult,
  type FeedbackAnswerStatus,
  type FeedbackDraft,
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

export type AnswerFeedbackResult =
  | { ok: true; data: FeedbackAnswerResult }
  | {
      ok: false;
      reason: "invalid-input";
      fieldErrors: { id?: string[]; text?: string[] };
    }
  | {
      ok: false;
      reason: "rate-limited";
      retryAfterSeconds?: number;
    }
  | {
      ok: false;
      reason: "access-denied" | "rejected" | "submission-unknown";
    };

export async function answerFeedback(
  id: unknown,
  input: unknown,
): Promise<AnswerFeedbackResult> {
  const parsedId = feedbackIdSchema.safeParse(id);
  if (!parsedId.success) {
    return {
      ok: false,
      reason: "invalid-input",
      fieldErrors: { id: ["The review ID is missing or invalid."] },
    };
  }

  const parsedAnswer = feedbackAnswerSchema.safeParse(input);
  if (!parsedAnswer.success) {
    return {
      ok: false,
      reason: "invalid-input",
      fieldErrors: {
        text: ["Enter a reply between 2 and 5,000 characters."],
      },
    };
  }

  const apiUrl = process.env.API_URL?.trim();
  if (!apiUrl) throw new Error("API_URL is required");

  const url = new URL(
    `/feedbacks/${encodeURIComponent(parsedId.data)}/answer`,
    apiUrl,
  );
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use HTTP or HTTPS");
  }

  let response: Response;
  let body: unknown;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsedAnswer.data),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });

    body = await response.json();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, reason: "submission-unknown" };
  }

  if (response.ok) {
    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "submitted"
    ) {
      return { ok: true, data: { status: "submitted" } };
    }

    return { ok: false, reason: "submission-unknown" };
  }

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

  if (response.status === 400 && hasCode(body, "WB_REPLY_REJECTED")) {
    return { ok: false, reason: "rejected" };
  }

  if (response.status === 400) {
    return {
      ok: false,
      reason: "invalid-input",
      fieldErrors: {},
    };
  }

  return { ok: false, reason: "submission-unknown" };
}

export type GetFeedbackAnswerResult =
  | { ok: true; data: FeedbackAnswerStatus }
  | { ok: false; reason: "access-denied" | "unavailable" }
  | { ok: false; reason: "rate-limited"; retryAfterSeconds?: number };

export async function getFeedbackAnswer(
  id: unknown,
): Promise<GetFeedbackAnswerResult> {
  const parsedId = feedbackIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, reason: "unavailable" };

  const apiUrl = process.env.API_URL?.trim();
  if (!apiUrl) throw new Error("API_URL is required");

  const url = new URL(
    `/feedbacks/${encodeURIComponent(parsedId.data)}/answer`,
    apiUrl,
  );
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use HTTP or HTTPS");
  }

  let response: Response;
  let body: unknown;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    body = await response.json();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, reason: "unavailable" };
  }

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
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const parsed = feedbackAnswerStatusSchema.safeParse(body);
  return parsed.success && parsed.data.id === parsedId.data
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "unavailable" };
}

export type GenerateFeedbackDraftResult =
  | { ok: true; data: FeedbackDraft }
  | { ok: false; reason: "rate-limited"; retryAfterSeconds?: number }
  | {
      ok: false;
      reason:
        | "invalid-input"
        | "already-answered"
        | "access-denied"
        | "timeout"
        | "unavailable"
        | "invalid-response";
    };

export async function generateFeedbackDraft(
  id: unknown,
): Promise<GenerateFeedbackDraftResult> {
  const parsedId = feedbackIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, reason: "invalid-input" };

  const feedbackId = parsedId.data;
  // Reject IDs that URL construction would normalize or fail to encode.
  if (feedbackId === "." || feedbackId === ".." || !feedbackId.isWellFormed()) {
    return { ok: false, reason: "invalid-input" };
  }

  const apiUrl = process.env.API_URL?.trim();
  if (!apiUrl) throw new Error("API_URL is required");

  const url = new URL(`/feedbacks/${encodeURIComponent(feedbackId)}/draft`, apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use HTTP or HTTPS");
  }

  // Allow the API's 25-second draft deadline to expire first.
  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal,
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
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After")?.trim();
    const seconds = /^\d+$/.test(retryAfter ?? "") ? Number(retryAfter) : NaN;
    return {
      ok: false,
      reason: "rate-limited",
      retryAfterSeconds: Number.isSafeInteger(seconds) ? seconds : undefined,
    };
  }
  if (signal.aborted || response.status === 504) {
    return { ok: false, reason: "timeout" };
  }
  if (response.status === 409 && hasCode(body, "FEEDBACK_ALREADY_ANSWERED")) {
    return { ok: false, reason: "already-answered" };
  }
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
  if (
    response.status === 502 &&
    (hasCode(body, "WB_INVALID_RESPONSE") || hasCode(body, "AI_INVALID_RESPONSE"))
  ) {
    return { ok: false, reason: "invalid-response" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const parsed = feedbackDraftSchema.safeParse(body);
  return parsed.success && parsed.data.feedbackId === feedbackId
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "invalid-response" };
}
