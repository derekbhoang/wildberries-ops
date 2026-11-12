import { HttpException, Logger } from '@nestjs/common';
import { HttpClient } from '@nestjs/http-client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { WildberriesService } from './wildberries.service.js';

describe('WildberriesService', () => {
  const secret = 'test-secret-do-not-log';
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  const feedback = {
    id: 'review-1',
    text: 'Good product',
    pros: null,
    cons: '',
    productValuation: 5,
    createdDate: '2026-11-12T00:00:00Z',
    productDetails: { nmId: 123, productName: 'Test product' },
  };
  const page = {
    countUnanswered: 52,
    countArchive: 1000,
    feedbacks: [feedback],
  };
  let service: WildberriesService;
  let warnMock: MockInstance<Logger['warn']>;
  let errorMock: MockInstance<Logger['error']>;

  beforeEach(() => {
    fetchMock.mockReset();
    warnMock = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorMock = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service = new WildberriesService(
      new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        headers: { Authorization: secret },
        timeout: 10_000,
        retry: false,
        fetch: fetchMock,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectFailure(status: number) {
    let caught: unknown;
    try {
      await service.listUnansweredFeedbacks();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    if (!(caught instanceof HttpException)) {
      throw new Error('Expected an HTTP exception');
    }

    expect(caught.getStatus()).toBe(status);
    expect(
      JSON.stringify({
        response: caught.getResponse(),
        warnings: warnMock.mock.calls,
        errors: errorMock.mock.calls,
      }),
    ).not.toContain(secret);
    return caught.getResponse();
  }

  it('returns validated reviews and requests the default unanswered page', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: page, errorText: secret }),
    );

    await expect(service.listUnansweredFeedbacks()).resolves.toEqual(page);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe('https://feedbacks-api.wildberries.ru');
    expect(url.pathname).toBe('/api/v1/feedbacks');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      isAnswered: 'false',
      take: '50',
      skip: '0',
      order: 'dateDesc',
    });
    expect(new Headers(options?.headers).get('Authorization')).toBe(secret);
    expect(warnMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it('accepts an empty page and forwards explicit pagination', async () => {
    const emptyPage = { ...page, feedbacks: [] };
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: emptyPage }),
    );

    await expect(
      service.listUnansweredFeedbacks({ take: 25, skip: 50 }),
    ).resolves.toEqual(emptyPage);
    const [input] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get('take')).toBe('25');
    expect(url.searchParams.get('skip')).toBe('50');
  });

  it.each([
    { take: 0 },
    { take: 101 },
    { take: 1.5 },
    { skip: -1 },
    { skip: 200_000 },
    { skip: 0.5 },
  ])(
    'rejects invalid pagination %j before making an upstream request',
    async (options) => {
      await expect(
        service.listUnansweredFeedbacks(options),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('accepts reviews with missing optional text and product details', async () => {
    const minimalPage = {
      ...page,
      feedbacks: [
        {
          id: feedback.id,
          productValuation: feedback.productValuation,
          createdDate: feedback.createdDate,
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: minimalPage }),
    );

    await expect(service.listUnansweredFeedbacks()).resolves.toEqual(
      minimalPage,
    );
  });

  it.each([
    ['WB application error', { error: true, data: null, errorText: secret }],
    ['missing data', { error: false, errorText: secret }],
    ['invalid count', { error: false, data: { ...page, countUnanswered: -1 } }],
    [
      'invalid review fields',
      {
        error: false,
        data: {
          ...page,
          feedbacks: [{ ...feedback, productValuation: secret }],
        },
      },
    ],
  ])('rejects %s without exposing response values', async (_name, body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));

    await expectFailure(502);
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'listUnansweredFeedbacks',
      code: 'WB_INVALID_RESPONSE',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: expect.any(Array),
          code: expect.any(String),
        }),
      ]),
    });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'maps upstream %i to a seller access error',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { detail: secret },
          { status, headers: { 'X-Private': secret } },
        ),
      );

      await expect(expectFailure(502)).resolves.toEqual({
        code: 'WB_ACCESS_DENIED',
        message: 'Check the Wildberries API key and its permissions',
      });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'listUnansweredFeedbacks',
        code: 'WB_ACCESS_DENIED',
        upstreamStatus: status,
      });
      expect(errorMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['2', 2],
    ['0', 0],
    [' 12 ', 12],
    [null, undefined],
    ['', undefined],
    ['invalid', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['1e3', undefined],
    ['9007199254740992', undefined],
  ])(
    'maps a rate limit with retry header %s safely',
    async (value, expected) => {
      const headers = new Headers({ 'X-Private': secret });
      if (value !== null) {
        headers.set('X-Ratelimit-Retry', value);
      }
      fetchMock.mockResolvedValueOnce(
        Response.json({ detail: secret }, { status: 429, headers }),
      );

      await expect(expectFailure(503)).resolves.toEqual({
        code: 'WB_RATE_LIMITED',
        message: 'Wildberries request limit reached',
        retryAfterSeconds: expected,
      });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'listUnansweredFeedbacks',
        code: 'WB_RATE_LIMITED',
        upstreamStatus: 429,
        retryAfterSeconds: expected,
      });
      expect(errorMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([500, 503])(
    'maps upstream %i to 502 without exposing its body',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ detail: secret }, { status }),
      );

      await expectFailure(502);
      expect(warnMock).not.toHaveBeenCalled();
      expect(errorMock).toHaveBeenCalledTimes(1);
    },
  );

  it('maps malformed JSON to 502 without logging the raw body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`{"detail":"${secret}"`));

    await expectFailure(502);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to 502', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expectFailure(502);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('maps an HTTP client timeout to 504', async () => {
    service = new WildberriesService(
      new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        timeout: 10,
        retry: false,
        fetch: fetchMock,
      }),
    );
    fetchMock.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    await expectFailure(504);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
