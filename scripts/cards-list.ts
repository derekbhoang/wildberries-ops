const apiKey = process.env.WB_API_KEY?.trim();

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

try {
  const response = await fetch("https://content-api.wildberries.ru/content/v2/get/cards/list", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      settings: {
        sort: { ascending: true },
        cursor: { limit: 5 },
        filter: { withPhoto: -1 },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`POST /content/v2/get/cards/list: HTTP ${response.status}`);
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
