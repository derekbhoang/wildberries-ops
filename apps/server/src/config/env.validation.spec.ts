import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it.each([undefined, '', '   ', 123])(
    'rejects an invalid key: %j',
    (value) => {
      expect(() => validateEnv({ WB_API_KEY: value })).toThrow(
        'WB_API_KEY is required',
      );
    },
  );

  it('trims the key and preserves other settings without changing the input', () => {
    const env = { WB_API_KEY: '  wb-test-token  ', PORT: '3001' };

    expect(validateEnv(env)).toEqual({
      WB_API_KEY: 'wb-test-token',
      PORT: '3001',
    });
    expect(env.WB_API_KEY).toBe('  wb-test-token  ');
  });
});
