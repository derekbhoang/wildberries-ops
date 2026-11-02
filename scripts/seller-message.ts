const apiKey = process.env.WB_API_KEY?.trim();
const replySign = process.argv[2]?.trim();
const message = process.argv[3];

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

if (!replySign || !message?.trim()) {
  throw new Error('Usage: pnpm script scripts/seller-message.ts <reply-sign> "<message-text>"');
}

if (message.length > 1000) {
  throw new Error("Message text must contain at most 1000 characters.");
}

const form = new FormData();
form.set("replySign", replySign);
form.set("message", message);

try {
  const response = await fetch("https://buyer-chat-api.wildberries.ru/api/v1/seller/message", {
    method: "POST",
    headers: { Authorization: apiKey },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`POST /api/v1/seller/message: HTTP ${response.status}`);
  const retryAfter = response.headers.get("X-Ratelimit-Retry");
  if (retryAfter) console.log(`Retry after: ${retryAfter} seconds`);

  const body = await response.text();
  console.log(body.replaceAll(apiKey, "[REDACTED]").replaceAll(replySign, "[REDACTED]"));

  if (!response.ok) process.exitCode = 1;
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  console.error(text.replaceAll(apiKey, "[REDACTED]").replaceAll(replySign, "[REDACTED]"));
  process.exitCode = 1;
}
