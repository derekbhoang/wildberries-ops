const apiKey = process.env.WB_API_KEY?.trim();

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

const hosts = [
  "common-api.wildberries.ru",
  "content-api.wildberries.ru",
  "feedbacks-api.wildberries.ru",
  "buyer-chat-api.wildberries.ru",
];

for (const host of hosts) {
  try {
    const response = await fetch(`https://${host}/ping`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    console.log(`${host}: HTTP ${response.status}`);
    console.log((await response.text()).replaceAll(apiKey, "[REDACTED]"));

    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${host}: ${message.replaceAll(apiKey, "[REDACTED]")}`);
    process.exitCode = 1;
  }
}
