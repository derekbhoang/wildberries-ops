export function validateEnv(env: Record<string, unknown>) {
  const apiKey =
    typeof env.WB_API_KEY === 'string'
      ? env.WB_API_KEY.trim()
      : '';

  if (!apiKey) {
    throw new Error('WB_API_KEY is required');
  }

  return { ...env, WB_API_KEY: apiKey };
}
