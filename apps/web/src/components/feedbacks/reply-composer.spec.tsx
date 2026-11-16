import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  answerFeedbackAction,
  checkFeedbackAnswerAction,
  AnswerFeedbackActionState,
} from "@/app/actions/feedbacks";
import ReplyComposer from "./reply-composer";

const { answerMock, checkMock, refreshMock } = vi.hoisted(() => ({
  answerMock: vi.fn<typeof answerFeedbackAction>(),
  checkMock: vi.fn<typeof checkFeedbackAnswerAction>(),
  refreshMock: vi.fn(),
}));

vi.mock("@/app/actions/feedbacks", () => ({
  answerFeedbackAction: answerMock,
  checkFeedbackAnswerAction: checkMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const draft = "Thank you!\nWe appreciate your feedback.";

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
    render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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

  it.each(["rejected", "access-denied"] as const)(
    "preserves the draft after a %s response",
    async (reason) => {
      answerMock.mockResolvedValueOnce({
        status: "error",
        ok: false,
        reason,
        message: "Unable to submit this reply.",
      });
      render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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
    render(<ReplyComposer feedbackId="review-1" />);
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
});
