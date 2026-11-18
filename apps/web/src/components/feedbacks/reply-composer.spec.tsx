import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import Home from "@/app/page";
import type {
  answerFeedbackAction,
  checkFeedbackAnswerAction,
  AnswerFeedbackActionState,
  GenerateFeedbackDraftActionResult,
} from "@/app/actions/feedbacks";
import ReplyComposer from "./reply-composer";
import type { GenerateReplyDraftAction } from "./reply-draft";

const { answerMock, checkMock, refreshMock, reviewResultsMock } = vi.hoisted(() => ({
  answerMock: vi.fn<typeof answerFeedbackAction>(),
  checkMock: vi.fn<typeof checkFeedbackAnswerAction>(),
  refreshMock: vi.fn(),
  reviewResultsMock: vi.fn<() => ReactNode>(),
}));

vi.mock("@/app/actions/feedbacks", () => ({
  answerFeedbackAction: answerMock,
  checkFeedbackAnswerAction: checkMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/components/feedbacks/reviews-content", () => ({
  default: () => reviewResultsMock(),
  ReviewsSkeleton: () => null,
}));

const draft = "Thank you!\nWe appreciate your feedback.";
const pageProps = {
  params: Promise.resolve({}),
  searchParams: Promise.resolve({}),
} satisfies PageProps<"/">;

function renderComposer() {
  return render(<Home {...pageProps} />);
}

function enterDraft() {
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reply",
  });
  fireEvent.change(input, { target: { value: draft } });
  return input;
}

describe("ReplyComposer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reviewResultsMock.mockReturnValue(<ReplyComposer feedbackId="review-1" />);
    answerMock.mockResolvedValue({
      status: "submitted",
      message: "Reply submitted.",
    });
    checkMock.mockResolvedValue({
      status: "unanswered",
      message: "Wildberries currently shows no reply.",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([
    { name: "empty text", text: "" },
    { name: "whitespace-only text", text: " \n\t " },
    { name: "one character after trimming", text: "  a  " },
    { name: "overlong text", text: "a".repeat(5001) },
  ])("prevents sending $name", ({ text }) => {
    renderComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: text },
    });

    const send = screen.getByRole<HTMLButtonElement>("button", {
      name: "Send reply",
    });
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(answerMock).not.toHaveBeenCalled();
  });

  it("submits once after repeated clicks and refreshes after success", async () => {
    const submission = Promise.withResolvers<AnswerFeedbackActionState>();
    answerMock.mockReturnValueOnce(submission.promise);
    renderComposer();
    const input = enterDraft();
    const send = screen.getByRole<HTMLButtonElement>("button", {
      name: "Send reply",
    });

    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() => expect(answerMock).toHaveBeenCalledTimes(1));
    expect(send.disabled).toBe(true);
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(draft);
    expect(refreshMock).not.toHaveBeenCalled();

    const [id, , formData] = answerMock.mock.calls[0]!;
    expect(id).toBe("review-1");
    expect(formData.get("text")).toBe(draft);

    await act(async () => {
      submission.resolve({ status: "submitted", message: "Reply submitted." });
    });

    expect(screen.getByRole("status").textContent).toBe("Reply submitted.");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the submission confirmation when refreshing replaces the inbox with an error", async () => {
    const view = renderComposer();
    refreshMock.mockImplementationOnce(() => {
      reviewResultsMock.mockReturnValue(
        <section role="alert">Couldn’t load reviews</section>,
      );
      view.rerender(<Home {...pageProps} />);
    });
    enterDraft();

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t load reviews",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Reply submitted.");
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Reply submitted.")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Couldn’t load reviews");
  });

  it.each(["rejected", "access-denied"] as const)(
    "preserves the draft after a %s response",
    async (reason) => {
      answerMock.mockResolvedValueOnce({
        status: "error",
        ok: false,
        reason,
        message: "Unable to submit this reply.",
      });
      renderComposer();
      const input = enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Unable to submit this reply.",
      );
      expect(input.value).toBe(draft);
      expect(input.readOnly).toBe(false);
      expect(refreshMock).not.toHaveBeenCalled();
    },
  );

  it("displays a server field error while preserving the draft", async () => {
    answerMock.mockResolvedValueOnce({
      status: "error",
      ok: false,
      reason: "invalid-input",
      message: "Check the reply text.",
      fieldErrors: { text: ["The reply text is invalid."] },
    });
    renderComposer();
    const input = enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await screen.findByText("The reply text is invalid.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe(draft);
  });

  it("waits for the rate-limit cooldown before allowing another send", async () => {
    vi.useFakeTimers();
    answerMock.mockResolvedValueOnce({
      status: "error",
      ok: false,
      reason: "rate-limited",
      message: "Wait before sending again.",
      retryAfterSeconds: 2,
    });
    renderComposer();
    const input = enterDraft();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    });

    const send = screen.getByRole<HTMLButtonElement>("button", {
      name: "Send reply",
    });
    expect(send.disabled).toBe(true);
    expect(screen.getByText("Try again in 2 seconds.")).toBeDefined();
    fireEvent.click(send);
    expect(answerMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(send.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(send.disabled).toBe(false);
    expect(input.value).toBe(draft);
  });

  it("requires a status check after losing the submission response", async () => {
    answerMock.mockRejectedValueOnce(new Error("Connection lost"));
    renderComposer();
    const input = enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    const check = await screen.findByRole("button", {
      name: "Check reply status",
    });
    const send = screen.getByRole<HTMLButtonElement>("button", {
      name: "Send reply",
    });
    expect(send.disabled).toBe(true);
    expect(input.value).toBe(draft);

    fireEvent.click(check);
    await screen.findByText("Wildberries currently shows no reply.");
    expect(checkMock).toHaveBeenCalledExactlyOnceWith("review-1");
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(send.disabled).toBe(false);
    expect(input.value).toBe(draft);
  });

  it("keeps sending blocked when the status check also fails", async () => {
    answerMock.mockResolvedValueOnce({
      status: "error",
      ok: false,
      reason: "submission-unknown",
      message: "Could not confirm submission.",
    });
    checkMock.mockResolvedValueOnce({
      status: "error",
      ok: false,
      reason: "unavailable",
      message: "Could not check the reply status.",
    });
    renderComposer();
    const input = enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Check reply status",
      }),
    );

    await screen.findByText("Could not check the reply status.");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Send reply",
      }).disabled,
    ).toBe(true);
    expect(input.value).toBe(draft);
    expect(answerMock).toHaveBeenCalledTimes(1);
  });

  it("shows an existing reply and prevents sending it again", async () => {
    answerMock.mockResolvedValueOnce({
      status: "error",
      ok: false,
      reason: "submission-unknown",
      message: "Could not confirm submission.",
    });
    checkMock.mockResolvedValueOnce({
      status: "answered",
      message: "A reply already exists on Wildberries.",
      answer: { text: draft, state: "reviewRequired" },
    });
    renderComposer();
    const input = enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Check reply status",
      }),
    );

    await screen.findByText("A reply already exists on Wildberries.");
    expect(screen.getByRole("blockquote").textContent).toBe(draft);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Send reply",
      }).disabled,
    ).toBe(true);
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(draft);
    expect(answerMock).toHaveBeenCalledTimes(1);
  });

  describe("AI drafts", () => {
    const suggestion = "Thank you for sharing your experience with our product.";
    let generateMock: ReturnType<typeof vi.fn<GenerateReplyDraftAction>>;

    beforeEach(() => {
      generateMock = vi.fn<GenerateReplyDraftAction>();
      generateMock.mockResolvedValue({ status: "generated", text: suggestion });
      reviewResultsMock.mockReturnValue(
        <ReplyComposer feedbackId="review-1" generateDraftAction={generateMock} />,
      );
    });

    it("disables generation until a generator is supplied", () => {
      reviewResultsMock.mockReturnValue(<ReplyComposer feedbackId="review-1" />);
      renderComposer();

      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Generate draft",
      }).disabled).toBe(true);
      expect(screen.getByText("AI drafting is currently unavailable.")).toBeDefined();
      expect(generateMock).not.toHaveBeenCalled();
    });

    it("previews and edits a draft, replacing reply text only when explicitly used", async () => {
      renderComposer();
      const input = enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

      const preview = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Draft preview",
      });
      expect(generateMock).toHaveBeenCalledExactlyOnceWith("review-1");
      expect(preview.value).toBe(suggestion);
      expect(input.value).toBe(draft);
      expect(screen.getByText(/Using this draft replaces your reply text/)).toBeDefined();
      expect(answerMock).not.toHaveBeenCalled();

      const editedSuggestion = "Thank you! We appreciate your detailed review.";
      fireEvent.change(preview, { target: { value: editedSuggestion } });
      expect(input.value).toBe(draft);
      fireEvent.click(screen.getByRole("button", { name: "Use draft" }));

      expect(input.value).toBe(editedSuggestion);
      expect(document.activeElement).toBe(input);
      expect(answerMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

      await waitFor(() => expect(answerMock).toHaveBeenCalledTimes(1));
      const [, , formData] = answerMock.mock.calls[0]!;
      expect(formData.get("text")).toBe(editedSuggestion);
      expect(formData.has("suggestion")).toBe(false);
    });

    it("allows writing and sending a manual reply while generation is pending", async () => {
      const generation = Promise.withResolvers<GenerateFeedbackDraftActionResult>();
      const submission = Promise.withResolvers<AnswerFeedbackActionState>();
      generateMock.mockReturnValueOnce(generation.promise);
      answerMock.mockReturnValueOnce(submission.promise);
      renderComposer();
      const input = enterDraft();
      const generate = screen.getByRole("button", { name: "Generate draft" });
      fireEvent.click(generate);
      fireEvent.click(generate);
      expect(generateMock).toHaveBeenCalledTimes(1);
      expect(input.readOnly).toBe(false);

      const manualReply = "I wrote this reply while the draft was generating.";
      fireEvent.change(input, { target: { value: manualReply } });
      fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
      await waitFor(() => expect(answerMock).toHaveBeenCalledTimes(1));

      await act(async () => generation.resolve({ status: "generated", text: suggestion }));
      expect(input.value).toBe(manualReply);
      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Use draft",
      }).disabled).toBe(true);

      await act(async () => submission.resolve({
        status: "submitted",
        message: "Reply submitted.",
      }));
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(answerMock.mock.calls[0]![2].get("text")).toBe(manualReply);
    });

    it("preserves reply text and an edited preview when regeneration fails", async () => {
      renderComposer();
      const input = enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      const preview = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Draft preview",
      });
      const editedSuggestion = "My edits to the suggested reply.";
      fireEvent.change(preview, { target: { value: editedSuggestion } });
      generateMock.mockRejectedValueOnce(new Error("Provider unavailable"));
      fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "We couldn't generate a draft. Try again or write your reply.",
      );
      expect(input.value).toBe(draft);
      expect(preview.value).toBe(editedSuggestion);
      expect(answerMock).not.toHaveBeenCalled();
    });

    it.each(["", " \n\t ", "a", "a".repeat(5001)])(
      "rejects invalid generated text without changing the reply (%#)",
      async (text) => {
        generateMock.mockResolvedValueOnce({ status: "generated", text });
        renderComposer();
        const input = enterDraft();
        fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

        expect((await screen.findByRole("alert")).textContent).toBe(
          "We couldn't generate a valid draft. Try again or write your reply.",
        );
        expect(input.value).toBe(draft);
        expect(screen.queryByRole("textbox", { name: "Draft preview" })).toBeNull();
        expect(answerMock).not.toHaveBeenCalled();
      },
    );

    it("prevents using an invalid edited preview while keeping manual sending available", async () => {
      renderComposer();
      const input = enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      const preview = await screen.findByRole("textbox", { name: "Draft preview" });
      fireEvent.change(preview, { target: { value: " " } });

      expect(preview.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Use draft",
      }).disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Send reply",
      }).disabled).toBe(false);
      expect(input.value).toBe(draft);
    });

    it.each(["resolve", "reject"] as const)(
      "ignores a cancelled request that later %ss after a newer draft arrives",
      async (outcome) => {
        const oldGeneration = Promise.withResolvers<GenerateFeedbackDraftActionResult>();
        generateMock.mockReturnValueOnce(oldGeneration.promise);
        renderComposer();
        const input = enterDraft();
        fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));
        fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

        const preview = await screen.findByRole<HTMLTextAreaElement>("textbox", {
          name: "Draft preview",
        });
        await act(async () => {
          if (outcome === "resolve") {
            oldGeneration.resolve({ status: "generated", text: "This is a stale draft." });
          } else {
            oldGeneration.reject(new Error("Stale error"));
          }
        });

        expect(preview.value).toBe(suggestion);
        expect(input.value).toBe(draft);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(answerMock).not.toHaveBeenCalled();
      },
    );

    it("discards the old review's text and pending generation when the review changes", async () => {
      const oldGeneration = Promise.withResolvers<GenerateFeedbackDraftActionResult>();
      generateMock.mockReturnValueOnce(oldGeneration.promise);
      const view = renderComposer();
      enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      reviewResultsMock.mockReturnValue(
        <ReplyComposer feedbackId="review-2" generateDraftAction={generateMock} />,
      );
      view.rerender(<Home {...pageProps} />);

      expect(screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply",
      }).value).toBe("");
      await act(async () => oldGeneration.resolve({ status: "generated", text: "Old review's draft." }));
      expect(screen.queryByRole("textbox", { name: "Draft preview" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      const preview = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Draft preview",
      });
      expect(preview.value).toBe(suggestion);
      expect(generateMock).toHaveBeenLastCalledWith("review-2");
    });

    it("keeps draft controls from bypassing an uncertain submission status", async () => {
      answerMock.mockResolvedValueOnce({
        status: "error",
        ok: false,
        reason: "submission-unknown",
        message: "Could not confirm submission.",
      });
      checkMock.mockResolvedValueOnce({
        status: "answered",
        message: "A reply already exists on Wildberries.",
        answer: { text: draft, state: "reviewRequired" },
      });
      renderComposer();
      enterDraft();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      await screen.findByRole("textbox", { name: "Draft preview" });
      fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
      const check = await screen.findByRole("button", { name: "Check reply status" });

      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Use draft",
      }).disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>("button", {
        name: "Regenerate",
      }).disabled).toBe(true);
      fireEvent.click(check);
      await screen.findByText("A reply already exists on Wildberries.");
      expect(screen.queryByRole("region", { name: "AI draft" })).toBeNull();
      expect(answerMock).toHaveBeenCalledTimes(1);
    });
  });
});
