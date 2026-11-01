const apiKey = process.env.WB_API_KEY?.trim();
const feedbackId = process.argv[2]?.trim();
const text = process.argv[3];

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

if (!feedbackId || !text?.trim()) {
  throw new Error('Usage: pnpm script scripts/feedbacks-answer.ts <feedback-id> "<reply-text>"');
}

if (text.length < 2 || text.length > 5000) {
  throw new Error("Reply text must contain 2 to 5000 characters.");
}

try {
  const response = await fetch("https://feedbacks-api.wildberries.ru/api/v1/feedbacks/answer", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ id: feedbackId, text }),
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`POST /api/v1/feedbacks/answer: HTTP ${response.status}`);
  const retryAfter = response.headers.get("X-Ratelimit-Retry");
  if (retryAfter) console.log(`Retry after: ${retryAfter} seconds`);
  console.log((await response.text()).replaceAll(apiKey, "[REDACTED]"));

  if (!response.ok) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replaceAll(apiKey, "[REDACTED]"));
  process.exitCode = 1;
}
