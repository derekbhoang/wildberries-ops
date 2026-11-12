import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FeedbacksController } from './feedbacks.controller.js';
import type { FeedbacksPage } from './wildberries.schemas.js';
import { WildberriesService } from './wildberries.service.js';

describe('GET /feedbacks', () => {
  let app: INestApplication<Server>;
  const listUnansweredFeedbacks =
    vi.fn<WildberriesService['listUnansweredFeedbacks']>();
  const page: FeedbacksPage = {
    countUnanswered: 12,
    countArchive: 30,
    feedbacks: [
      {
        id: 'review-1',
        text: 'Great product',
        productValuation: 5,
        createdDate: '2026-11-12T00:00:00Z',
        productDetails: { nmId: 123, productName: 'Coffee' },
      },
    ],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FeedbacksController],
      providers: [
        {
          provide: WildberriesService,
          useValue: { listUnansweredFeedbacks },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  beforeEach(() => {
    listUnansweredFeedbacks.mockReset();
    listUnansweredFeedbacks.mockResolvedValue(page);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns JSON and supplies default pagination', async () => {
    await request(app.getHttpServer())
      .get('/feedbacks')
      .expect('Content-Type', /json/)
      .expect(200)
      .expect(page);

    expect(listUnansweredFeedbacks).toHaveBeenCalledExactlyOnceWith({
      take: 50,
      skip: 0,
    });
  });

  it.each([
    { query: 'take=10&skip=20', options: { take: 10, skip: 20 } },
    { query: 'take=1', options: { take: 1, skip: 0 } },
    { query: 'skip=100', options: { take: 50, skip: 100 } },
    { query: 'take=100&skip=199990', options: { take: 100, skip: 199_990 } },
  ])('parses pagination from $query', async ({ query, options }) => {
    await request(app.getHttpServer())
      .get(`/feedbacks?${query}`)
      .expect(200)
      .expect(page);

    expect(listUnansweredFeedbacks).toHaveBeenCalledExactlyOnceWith(options);
  });

  it('returns a successful empty page', async () => {
    const emptyPage: FeedbacksPage = {
      countUnanswered: 0,
      countArchive: 30,
      feedbacks: [],
    };
    listUnansweredFeedbacks.mockResolvedValueOnce(emptyPage);

    await request(app.getHttpServer())
      .get('/feedbacks')
      .expect(200)
      .expect(emptyPage);
  });

  it.each([
    'take=0',
    'take=101',
    'skip=-1',
    'skip=199991',
    'take=1.5',
    'take=abc',
    'take=',
    'skip=',
    'take=1&take=2',
    'skip=0&skip=20',
    'take=1e2',
    'take=0x10',
    'take=9007199254740992',
    'take%5Bvalue%5D=10',
    'isAnswered=true',
  ])('rejects invalid query %s before calling the service', async (query) => {
    await request(app.getHttpServer()).get(`/feedbacks?${query}`).expect(400);

    expect(listUnansweredFeedbacks).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'seller access failure',
      status: 502,
      makeError: () =>
        new BadGatewayException({
          code: 'WB_ACCESS_DENIED',
          message: 'Check the Wildberries API key and its permissions',
        }),
    },
    {
      name: 'rate limit and retry metadata',
      status: 503,
      makeError: () =>
        new ServiceUnavailableException({
          code: 'WB_RATE_LIMITED',
          message: 'Wildberries request limit reached',
          retryAfterSeconds: 12,
        }),
    },
    {
      name: 'timeout',
      status: 504,
      makeError: () => new GatewayTimeoutException(),
    },
  ])('preserves the service $name', async ({ status, makeError }) => {
    const error = makeError();
    listUnansweredFeedbacks.mockRejectedValueOnce(error);

    const response = await request(app.getHttpServer())
      .get('/feedbacks')
      .expect(status);

    expect(response.body).toEqual(error.getResponse());
    expect(listUnansweredFeedbacks).toHaveBeenCalledTimes(1);
  });
});
