import { writeFile } from "node:fs/promises";

const apiKey = process.env.WB_API_KEY?.trim();
const downloadId = process.argv[2]?.trim();
const outputPath = process.argv[3];

if (!apiKey) {
  throw new Error("Set WB_API_KEY in .env before running this script.");
}

if (!downloadId || !outputPath) {
  throw new Error("Usage: pnpm script scripts/seller-download.ts <download-id> <output-path>");
}

try {
  const response = await fetch(`https://buyer-chat-api.wildberries.ru/api/v1/seller/download/${encodeURIComponent(downloadId)}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  console.log(`GET /api/v1/seller/download/{id}: HTTP ${response.status}`);
  console.log(`Content-Type: ${response.headers.get("Content-Type")}`);
  const retryAfter = response.headers.get("X-Ratelimit-Retry");
  if (retryAfter) console.log(`Retry after: ${retryAfter} seconds`);

  if (response.status === 200) {
    const body = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, body, { flag: "wx" });
    console.log(`Saved ${body.length} bytes to ${outputPath}`);
  } else {
    console.log((await response.text()).replaceAll(apiKey, "[REDACTED]"));
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replaceAll(apiKey, "[REDACTED]"));
  process.exitCode = 1;
}
