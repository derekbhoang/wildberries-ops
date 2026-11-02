const apiKey = process.env.WB_API_KEY?.trim();
const questionId = process.argv[2]?.trim();

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

if (!questionId) {
  throw new Error("Usage: pnpm script scripts/question.ts <question-id>");
}

const url = new URL("https://feedbacks-api.wildberries.ru/api/v1/question");
url.searchParams.set("id", questionId);

try {
  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`GET /api/v1/question: HTTP ${response.status}`);
  const retryAfter = response.headers.get("X-Ratelimit-Retry");
  if (retryAfter) console.log(`Retry after: ${retryAfter} seconds`);
  console.log((await response.text()).replaceAll(apiKey, "[REDACTED]"));

  if (!response.ok) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replaceAll(apiKey, "[REDACTED]"));
  process.exitCode = 1;
}
