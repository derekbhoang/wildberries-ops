import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReplyNotifications from "./reply-notifications";
import { ReviewResults } from "./reviews-content";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn(),
  useRouter: () => ({ refresh }),
}));

const feedbackId = "review-1";
const draftText = "Thank you for your feedback.";
const editedText = "Thank you for sharing your feedback about the coffee.";
const manualText = "Thank you for leaving us a review.";
const fetchMock = vi.fn<typeof fetch>();
const feedback = {
  id: feedbackId,
  text: "Great coffee.",
  productValuation: 5,
  createdDate: "2026-11-18T00:00:00Z",
  productDetails: { nmId: 123456, productName: "Coffee" },
};

async function renderInbox() {
  // Resolve the async Server Component before rendering its interactive children.
  const results = await ReviewResults({ page: 1 });
  render(<ReplyNotifications>{results}</ReplyNotifications>);
}

function enterManualReply() {
  const reply = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reply",
  });
  fireEvent.change(reply, { target: { value: manualText } });
  return reply;
}

describe("Review inbox", () => {
  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("API_URL", "http://api.test");
    fetchMock.mockResolvedValueOnce(
      Response.json({
        countUnanswered: 1,
        countArchive: 0,
        feedbacks: [feedback],
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("displays review metadata when present and handles unfamiliar statuses", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        countUnanswered: 3,
        countArchive: 0,
        feedbacks: [
          {
            ...feedback,
            productDetails: { ...feedback.productDetails, size: " M " },
            userName: " Anna ",
            orderStatus: "returned",
          },
          { ...feedback, id: "review-2", orderStatus: "futureStatus" },
          { ...feedback, id: "review-3" },
        ],
      }),
    );
    await renderInbox();

    const count = screen.getByText("unanswered reviews in the last 3 days");
    expect(count.textContent).toBe("3 unanswered reviews in the last 3 days");

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    const complete = cards[0]!;
    const unfamiliar = cards[1]!;
    const missing = cards[2]!;
    expect(within(complete).getByText("WB 123456 · Size M")).toBeTruthy();
    expect(within(complete).getByText("Returned")).toBeTruthy();
    expect(complete.querySelector("footer")?.textContent).toBe(
      "Anna · 18 Nov 2026",
    );
    expect(within(unfamiliar).getByText("Unknown order status")).toBeTruthy();
    expect(within(missing).getByText("WB 123456")).toBeTruthy();
    expect(within(missing).queryByText(/order status/i)).toBeNull();
    expect(missing.querySelector("footer")?.textContent).toBe("18 Nov 2026");
  });

  it("generates and uses an edited draft before explicitly sending it", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ feedbackId, text: draftText }),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ status: "submitted" }));
    await renderInbox();

    const generate = screen.getByRole<HTMLButtonElement>("button", {
      name: "Generate draft",
    });
    expect(generate.disabled).toBe(false);
    const reply = enterManualReply();
    fireEvent.click(generate);

    const preview = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Draft preview",
    });
    expect(preview.value).toBe(draftText);
    expect(reply.value).toBe(manualText);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(`http://api.test/feedbacks/${feedbackId}/draft`),
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.change(preview, { target: { value: editedText } });
    fireEvent.click(screen.getByRole("button", { name: "Use draft" }));
    expect(reply.value).toBe(editedText);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText("Reply submitted.");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL(`http://api.test/feedbacks/${feedbackId}/answer`),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: editedText }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      scenario: "a draft for another review",
      response: () => Response.json({ feedbackId: "review-2", text: draftText }),
      message: /valid draft/i,
      canSend: true,
    },
    {
      scenario: "a rate limit with a retry time",
      response: () =>
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
      message: /wait 12 seconds/i,
      canSend: true,
    },
    {
      scenario: "a draft timeout",
      response: () => Response.json({ code: "DRAFT_TIMEOUT" }, { status: 504 }),
      message: /took too long/i,
      canSend: true,
    },
    {
      scenario: "a review that already has an answer",
      response: () =>
        Response.json({ code: "FEEDBACK_ALREADY_ANSWERED" }, { status: 409 }),
      message: /a reply already exists/i,
      canSend: false,
    },
  ])(
    "handles $scenario and preserves the manual reply",
    async ({ response, message, canSend }) => {
      fetchMock.mockResolvedValueOnce(response());
      await renderInbox();

      const reply = enterManualReply();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

      const error = await screen.findByRole("alert");
      expect(error.textContent).toMatch(message);
      expect(screen.queryByRole("textbox", { name: "Draft preview" })).toBeNull();
      expect(reply.value).toBe(manualText);
      const send = screen.getByRole<HTMLButtonElement>("button", {
        name: "Send reply",
      });
      expect(send.disabled).toBe(!canSend);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
