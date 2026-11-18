"use server";

import type { FeedbackAnswerStatus } from "@wildberries-ops/contracts";
import {
  answerFeedback,
  generateFeedbackDraft,
  getFeedbackAnswer,
  type AnswerFeedbackResult,
  type GenerateFeedbackDraftResult,
  type GetFeedbackAnswerResult,
} from "@/lib/feedbacks";

type AnswerFeedbackFailure = Extract<AnswerFeedbackResult, { ok: false }>;

export type AnswerFeedbackActionState =
  | { status: "idle"; message: string }
  | { status: "submitted"; message: string }
  | (AnswerFeedbackFailure & { status: "error"; message: string });

const failureMessages: Record<AnswerFeedbackFailure["reason"], string> = {
  "invalid-input": "Check the review and enter a reply between 2 and 5,000 characters.",
  "access-denied": "Check your seller connection and API key permissions.",
  "rate-limited": "Wildberries has temporarily limited requests. Wait before sending again.",
  rejected: "Wildberries rejected the reply. Review the text before sending again.",
  "submission-unknown":
    "We couldn’t confirm whether your reply was submitted. Check the review before sending again.",
};

export async function answerFeedbackAction(
  feedbackId: string,
  _previousState: AnswerFeedbackActionState,
  formData: FormData,
): Promise<AnswerFeedbackActionState> {
  const result = await answerFeedback(feedbackId, {
    text: formData.get("text"),
  });

  if (!result.ok) {
    return {
      ...result,
      status: "error",
      message: failureMessages[result.reason],
    };
  }

  return { status: "submitted", message: "Reply submitted." };
}

type GetFeedbackAnswerFailure = Extract<GetFeedbackAnswerResult, { ok: false }>;

export type CheckFeedbackAnswerActionState =
  | {
      status: "answered";
      message: string;
      answer: NonNullable<FeedbackAnswerStatus["answer"]>;
    }
  | { status: "unanswered"; message: string }
  | (GetFeedbackAnswerFailure & { status: "error"; message: string });

const checkFailureMessages: Record<GetFeedbackAnswerFailure["reason"], string> = {
  "access-denied": "Check your seller connection and API key permissions, then check the reply status again.",
  "rate-limited": "Wildberries has temporarily limited requests. Wait before checking again.",
  unavailable: "We couldn't check the reply status. Check again before sending your reply.",
};

export async function checkFeedbackAnswerAction(
  feedbackId: string,
): Promise<CheckFeedbackAnswerActionState> {
  const result = await getFeedbackAnswer(feedbackId);
  if (!result.ok) {
    return {
      ...result,
      status: "error",
      message: checkFailureMessages[result.reason],
    };
  }

  if (result.data.answer !== null) {
    return {
      status: "answered",
      message: "A reply already exists on Wildberries.",
      answer: result.data.answer,
    };
  }

  return {
    status: "unanswered",
    message: "Wildberries currently shows no reply. Review your draft before sending again.",
  };
}

type GenerateFeedbackDraftFailure = Extract<
  GenerateFeedbackDraftResult,
  { ok: false }
>;

export type GenerateFeedbackDraftActionResult =
  | { status: "generated"; text: string }
  | (GenerateFeedbackDraftFailure & { status: "error"; message: string });

const draftFailureMessages: Record<GenerateFeedbackDraftFailure["reason"], string> = {
  "invalid-input": "This review is invalid. Refresh the inbox and try again.",
  "already-answered": "A reply already exists on Wildberries. Refresh the inbox to see the latest reviews.",
  "access-denied": "Check your seller connection and API key permissions.",
  "rate-limited": "Draft generation is temporarily rate limited. Try again shortly or write your reply.",
  timeout: "Generating a draft took too long. Try again or write your reply.",
  unavailable: "We couldn't generate a draft. Try again or write your reply.",
  "invalid-response": "We couldn't generate a valid draft. Try again or write your reply.",
};

export async function generateFeedbackDraftAction(
  feedbackId: string,
): Promise<GenerateFeedbackDraftActionResult> {
  const result = await generateFeedbackDraft(feedbackId);
  if (result.ok) return { status: "generated", text: result.data.text };

  let message = draftFailureMessages[result.reason];
  if (result.reason === "rate-limited" && result.retryAfterSeconds) {
    const seconds = result.retryAfterSeconds;
    const duration = `${seconds.toLocaleString("en-AU")} ${seconds === 1 ? "second" : "seconds"}`;
    message = `Draft generation is temporarily rate limited. Wait ${duration} before trying again, or write your reply.`;
  }

  return { ...result, status: "error", message };
}
