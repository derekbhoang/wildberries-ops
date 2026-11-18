import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import type { Env } from '../src/config/env.validation.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    vi.stubEnv('PORT', '43001');
    vi.stubEnv('WB_API_KEY', '  test-wb-api-key  ');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-api-key');
    vi.stubEnv('OPENAI_REPLY_MODEL', 'test-reply-model');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('provides validated environment variables through Nest configuration', () => {
    const config = app.get<ConfigService<Env, true>>(ConfigService);

    expect(config.get('PORT', { infer: true })).toBe(43001);
    expect(config.get('WB_API_KEY', { infer: true })).toBe('test-wb-api-key');
  });

  afterEach(async () => {
    await app.close();
  });
});
