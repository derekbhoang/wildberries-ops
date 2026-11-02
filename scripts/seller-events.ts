const apiKey = process.env.WB_API_KEY?.trim();
const next = process.argv[2]?.trim();

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

const url = new URL("https://buyer-chat-api.wildberries.ru/api/v1/seller/events");
if (next) url.searchParams.set("next", next);

try {
  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`GET /api/v1/seller/events: HTTP ${response.status}`);
  const retryAfter = response.headers.get("X-Ratelimit-Retry");
  if (retryAfter) console.log(`Retry after: ${retryAfter} seconds`);

  const body = await response.text();
  console.log(body.replaceAll(apiKey, "[REDACTED]"));

  if (!response.ok) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replaceAll(apiKey, "[REDACTED]"));
  process.exitCode = 1;
}
