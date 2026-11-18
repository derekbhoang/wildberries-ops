import { describe, expect, it } from 'vitest';
import { envSchema } from './env.validation.js';

const env = {
  WB_API_KEY: 'wb-test-token',
  OPENAI_API_KEY: 'openai-test-token',
  OPENAI_REPLY_MODEL: 'test-model',
};

describe('envSchema', () => {
  it('trims required settings and defaults to port 3000', () => {
    expect(
      envSchema.parse({
        WB_API_KEY: '  wb-test-token  ',
        OPENAI_API_KEY: '  openai-test-token  ',
        OPENAI_REPLY_MODEL: '  test-model  ',
        UNRELATED: 'ignored',
      }),
    ).toEqual({ ...env, PORT: 3000 });
  });

  it.each(['WB_API_KEY', 'OPENAI_API_KEY', 'OPENAI_REPLY_MODEL'])(
    'requires a nonempty %s',
    (key) => {
      for (const value of [undefined, '', '   ', 123]) {
        expect(envSchema.safeParse({ ...env, [key]: value })).toMatchObject({
          success: false,
          error: { issues: [{ path: [key], message: 'is required' }] },
        });
      }
    },
  );

  it.each([
    [' 3001 ', 3001],
    ['0', 0],
    ['65535', 65_535],
  ])('parses port %j as a number', (value, expected) => {
    expect(envSchema.parse({ ...env, PORT: value }).PORT).toBe(expected);
  });

  it.each(['', '   ', '-1', '65536', '1.5', '1e3', '0xFF', 'api.sock'])(
    'rejects invalid port %j',
    (value) => {
      expect(envSchema.safeParse({ ...env, PORT: value })).toMatchObject({
        success: false,
        error: { issues: [{ path: ['PORT'] }] },
      });
    },
  );
});
