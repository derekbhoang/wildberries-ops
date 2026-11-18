import { feedbackAnswerSchema } from "@wildberries-ops/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type GenerateReplyDraftAction = (
  feedbackId: string,
) => Promise<{ text: string }>;

export default function ReplyDraft({
  feedbackId,
  generateDraftAction,
  disabled,
  hasReply,
  onUseDraft,
}: {
  feedbackId: string;
  generateDraftAction?: GenerateReplyDraftAction;
  disabled: boolean;
  hasReply: boolean;
  onUseDraft: (text: string) => void;
}) {
  const inputId = useId();
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Ignore requests that finish after cancellation or this review is removed.
  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  async function generateDraft() {
    if (!generateDraftAction || disabled || inFlight.current) return;

    const currentRequest = ++requestId.current;
    inFlight.current = true;
    setGenerating(true);
    setError("");
    setNotice("");

    try {
      const result = await generateDraftAction(feedbackId);
      if (currentRequest !== requestId.current) return;

      const parsed = feedbackAnswerSchema.safeParse(result);
      if (!parsed.success) {
        setError("We couldn't generate a valid draft. Try again or write your reply.");
        return;
      }

      setSuggestion(parsed.data.text);
      setNotice("Draft ready. Review and edit it before using it.");
    } catch {
      if (currentRequest === requestId.current) {
        setError("We couldn't generate a draft. Try again or write your reply.");
      }
    } finally {
      if (currentRequest === requestId.current) {
        inFlight.current = false;
        setGenerating(false);
      }
    }
  }

  function cancelGeneration() {
    requestId.current += 1;
    inFlight.current = false;
    setGenerating(false);
    setNotice("Draft generation cancelled.");
  }

  const parsedSuggestion = feedbackAnswerSchema.safeParse({ text: suggestion });
  const suggestionError = suggestion !== null && !parsedSuggestion.success;

  return (
    <section aria-label="AI draft" className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={generateDraft}
          disabled={!generateDraftAction || disabled || generating}
          aria-describedby={!generateDraftAction ? `${inputId}-availability` : undefined}
        >
          {generating ? "Generating…" : suggestion === null ? "Generate draft" : "Regenerate"}
        </Button>
        {generating && (
          <Button type="button" variant="ghost" onClick={cancelGeneration}>
            Cancel generation
          </Button>
        )}
      </div>

      {!generateDraftAction && (
        <p id={`${inputId}-availability`} className="text-xs text-muted-foreground">
          AI drafting is currently unavailable.
        </p>
      )}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {generating ? "Generating a draft. You can keep writing your reply." : notice}
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {suggestion !== null && (
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            Draft preview
          </label>
          <textarea
            id={inputId}
            value={suggestion}
            onChange={(event) => {
              setSuggestion(event.target.value);
              setNotice("");
            }}
            maxLength={5000}
            rows={4}
            readOnly={disabled || generating}
            aria-invalid={suggestionError}
            aria-describedby={`${inputId}-count ${inputId}-error ${inputId}-help`}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <p id={`${inputId}-count`} className="text-xs text-muted-foreground">
            {suggestion.length.toLocaleString("en-AU")} / 5,000 characters
          </p>
          <p id={`${inputId}-error`} aria-live="polite" className="text-sm text-destructive">
            {suggestionError ? "Enter a draft between 2 and 5,000 characters." : ""}
          </p>
          <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
            {hasReply ? "Using this draft replaces your reply text. " : ""}
            Check the details before sending.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || generating || !parsedSuggestion.success}
            onClick={() => {
              if (disabled || generating || !parsedSuggestion.success) return;
              onUseDraft(parsedSuggestion.data.text);
              setNotice("Draft copied to your reply. Review it before sending.");
            }}
          >
            Use draft
          </Button>
        </div>
      )}
    </section>
  );
}
