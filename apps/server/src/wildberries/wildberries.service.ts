import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HttpClient,
  HttpClientError,
  HttpResponseError,
  InjectHttpClient,
  toHttpException,
} from '@nestjs/http-client';
import {
  feedbacksResponseSchema,
  type FeedbacksPage,
} from './wildberries.schemas.js';
import type {
  FeedbackAnswer,
  FeedbackAnswerResult,
} from '@wildberries-ops/contracts';

@Injectable()
export class WildberriesService {
  private readonly logger = new Logger(WildberriesService.name);

  constructor(
    @InjectHttpClient('wbFeedbacks')
    private readonly http: HttpClient,
  ) {}

  async listUnansweredFeedbacks({
    take = 50,
    skip = 0,
  }: { take?: number; skip?: number } = {}): Promise<FeedbacksPage> {
    if (
      !Number.isInteger(take) ||
      take < 1 ||
      take > 100 ||
      !Number.isInteger(skip) ||
      skip < 0 ||
      skip > 199_990
    ) {
      throw new BadRequestException('Invalid review pagination');
    }

    try {
      const { data: body } = await this.http.get<unknown>('/api/v1/feedbacks', {
        responseType: 'json',
        query: {
          isAnswered: false,
          take,
          skip,
          order: 'dateDesc',
        },
      });

      const parsed = feedbacksResponseSchema.safeParse(body);

      if (!parsed.success) {
        this.logger.warn({
          operation: 'listUnansweredFeedbacks',
          code: 'WB_INVALID_RESPONSE',
          issues: parsed.error.issues.map(({ path, code }) => ({ path, code })),
        });
        throw new BadGatewayException(
          'Wildberries returned an invalid or unsuccessful response',
        );
      }

      return parsed.data.data;
    } catch (error) {
      if (error instanceof HttpResponseError) {
        if (error.status === 401 || error.status === 403) {
          this.logger.warn({
            operation: 'listUnansweredFeedbacks',
            code: 'WB_ACCESS_DENIED',
            upstreamStatus: error.status,
          });
          throw new BadGatewayException({
            code: 'WB_ACCESS_DENIED',
            message: 'Check the Wildberries API key and its permissions',
          });
        }

        if (error.status === 429) {
          const value = error.headers.get('X-Ratelimit-Retry')?.trim() ?? '';
          const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
          const retryAfterSeconds = Number.isSafeInteger(seconds)
            ? seconds
            : undefined;

          this.logger.warn({
            operation: 'listUnansweredFeedbacks',
            code: 'WB_RATE_LIMITED',
            upstreamStatus: error.status,
            retryAfterSeconds,
          });
          throw new ServiceUnavailableException({
            code: 'WB_RATE_LIMITED',
            message: 'Wildberries request limit reached',
            retryAfterSeconds,
          });
        }
      }

      throw toHttpException(error);
    }
  }

  async answerFeedback(
    id: string,
    body: FeedbackAnswer,
  ): Promise<FeedbackAnswerResult> {
    try {
      const response = await this.http.post('/api/v1/feedbacks/answer', {
        json: { id, text: body.text },
        responseType: 'text',
        retry: false,
      });

      if (response.status !== 204) {
        throw new BadGatewayException({
          code: 'WB_SUBMISSION_UNKNOWN',
          message: 'Could not confirm whether Wildberries accepted the reply',
        });
      }

      return { status: 'submitted' };
    } catch (error) {
      if (error instanceof HttpResponseError) {
        if (error.status === 401 || error.status === 403) {
          throw new BadGatewayException({
            code: 'WB_ACCESS_DENIED',
            message: 'Check the Wildberries API key and its permissions',
          });
        }

        if (error.status === 429) {
          const value = error.headers.get('X-Ratelimit-Retry')?.trim() ?? '';
          const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;

          throw new ServiceUnavailableException({
            code: 'WB_RATE_LIMITED',
            message: 'Wildberries request limit reached',
            retryAfterSeconds: Number.isSafeInteger(seconds)
              ? seconds
              : undefined,
          });
        }

        if (error.status === 400) {
          throw new BadRequestException({
            code: 'WB_REPLY_REJECTED',
            message: 'Wildberries rejected the reply',
          });
        }
      }

      if (error instanceof HttpClientError) {
        this.logger.warn({
          operation: 'answerFeedback',
          feedbackId: id,
          code: 'WB_SUBMISSION_UNKNOWN',
          upstreamStatus:
            error instanceof HttpResponseError ? error.status : undefined,
        });

        throw new BadGatewayException({
          code: 'WB_SUBMISSION_UNKNOWN',
          message: 'Check the review before attempting to send the reply again',
        });
      }

      throw error;
    }
  }
}
