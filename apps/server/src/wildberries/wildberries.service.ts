import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HttpClient,
  HttpResponseError,
  InjectHttpClient,
  toHttpException,
} from '@nestjs/http-client';
import {
  feedbacksResponseSchema,
  type FeedbacksPage,
} from './wildberries.schemas.js';

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
}
