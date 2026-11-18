"use client";

import { feedbackAnswerSchema } from "@wildberries-ops/contracts";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import {
  answerFeedbackAction,
  checkFeedbackAnswerAction,
  type AnswerFeedbackActionState,
  type CheckFeedbackAnswerActionState,
} from "@/app/actions/feedbacks";
import { Button } from "@/components/ui/button";
import { useReplyNotification } from "@/components/feedbacks/reply-notifications";
import ReplyDraft, {
  type GenerateReplyDraftAction,
} from "@/components/feedbacks/reply-draft";

type ComposerState = (
  | AnswerFeedbackActionState
  | CheckFeedbackAnswerActionState
) & {
  retryAt?: number;
  needsStatusCheck?: boolean;
};

const initialState = { status: "idle", message: "" } satisfies ComposerState;
const replyLengthMessage = "Enter a reply between 2 and 5,000 characters.";

type ReplyComposerProps = {
  feedbackId: string;
  /** Supply a Server Action to enable AI drafting. */
  generateDraftAction?: GenerateReplyDraftAction;
};

export default function ReplyComposer(props: ReplyComposerProps) {
  return <ReviewReplyComposer key={props.feedbackId} {...props} />;
}

function ReviewReplyComposer({ feedbackId, generateDraftAction }: ReplyComposerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const notify = useReplyNotification();
  const [text, setText] = useState("");
  const [now, setNow] = useState(0);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  const [state, formAction, pending] = useActionState<ComposerState, FormData>(
    async (previousState, formData) => {
      if (
        alreadyAnswered ||
        previousState.status === "submitted" ||
        previousState.status === "answered" ||
        (previousState.retryAt !== undefined &&
          Date.now() < previousState.retryAt)
      ) {
        return previousState;
      }

      const checking = formData.get("intent") === "check";
      if (previousState.needsStatusCheck && !checking) return previousState;

      let result: AnswerFeedbackActionState | CheckFeedbackAnswerActionState;
      try {
        if (checking) {
          result = await checkFeedbackAnswerAction(feedbackId);
        } else {
          result = await answerFeedbackAction(
            feedbackId,
            initialState,
            formData,
          );
        }
      } catch {
        return {
          status: "error",
          ok: false,
          reason: "submission-unknown",
          message:
            "We couldn't confirm the reply status. Check again before sending your reply.",
          needsStatusCheck: true,
        };
      }

      if (result.status === "submitted") {
        notify(result.message);
        setText("");
        startTransition(() => router.refresh());
      }

      const needsStatusCheck =
        result.status === "error" &&
        (checking || result.reason === "submission-unknown");

      if (result.status === "error" && result.reason === "rate-limited") {
        const receivedAt = Date.now();
        setNow(receivedAt);

        return {
          ...result,
          needsStatusCheck,
          retryAt: receivedAt + (result.retryAfterSeconds ?? 60) * 1000,
        };
      }

      return { ...result, needsStatusCheck };
    },
    initialState,
  );

  const remainingSeconds = Math.max(
    0,
    Math.ceil(((state.retryAt ?? 0) - now) / 1000),
  );
  const coolingDown = remainingSeconds > 0;

  useEffect(() => {
    if (!coolingDown) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const valid = feedbackAnswerSchema.safeParse({ text }).success;

  const serverTextError =
    state.status === "error" && state.reason === "invalid-input"
      ? state.fieldErrors.text?.[0]
      : undefined;

  const textError =
    text.length > 0 && !valid ? replyLengthMessage : serverTextError;

  const needsStatusCheck = state.needsStatusCheck === true;
  const answered = alreadyAnswered || state.status === "answered";

  if (state.status === "submitted") return null;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-3">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Reply
      </label>

      <textarea
        id={inputId}
        ref={inputRef}
        name="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        required
        minLength={2}
        maxLength={5000}
        rows={4}
        readOnly={pending || answered}
        aria-invalid={Boolean(textError)}
        aria-describedby={`${inputId}-count ${inputId}-error`}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />

      <p id={`${inputId}-count`} className="text-xs text-muted-foreground">
        {text.length.toLocaleString("en-AU")} / 5,000 characters
      </p>

      <p
        id={`${inputId}-error`}
        aria-live="polite"
        className="text-sm text-destructive"
      >
        {textError}
      </p>

      {state.status !== "answered" && (
        <ReplyDraft
          feedbackId={feedbackId}
          generateDraftAction={generateDraftAction}
          disabled={pending || coolingDown || needsStatusCheck || answered}
          hasReply={text.length > 0}
          onAlreadyAnswered={() => setAlreadyAnswered(true)}
          onUseDraft={(draft) => {
            setText(draft);
            inputRef.current?.focus();
          }}
        />
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {(state.status === "answered" || state.status === "unanswered") && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      )}
      {state.status === "answered" && (
        <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
          {state.answer.text}
        </blockquote>
      )}
      {coolingDown && (
        <p role="status" className="text-sm text-muted-foreground">
          Try again in {remainingSeconds.toLocaleString("en-AU")} seconds.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="intent"
          value="send"
          disabled={pending || !valid || coolingDown || needsStatusCheck || answered}
        >
          {pending && !needsStatusCheck ? "Sending…" : "Send reply"}
        </Button>
        {needsStatusCheck && !answered && (
          <Button
            type="submit"
            name="intent"
            value="check"
            variant="outline"
            formNoValidate
            disabled={pending || coolingDown}
          >
            {pending ? "Checking…" : "Check reply status"}
          </Button>
        )}
      </div>
    </form>
  );
}
