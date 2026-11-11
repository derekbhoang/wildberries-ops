import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  HttpClient,
  InjectHttpClient,
  toHttpException,
} from '@nestjs/http-client';
import {
  feedbacksResponseSchema,
  type FeedbacksPage,
} from './wildberries.schemas.js';

@Injectable()
export class WildberriesService {
  constructor(
    @InjectHttpClient('wbFeedbacks')
    private readonly http: HttpClient,
  ) {}

  async listUnansweredFeedbacks(
    { take = 50, skip = 0 }: { take?: number; skip?: number } = {},
  ): Promise<FeedbacksPage> {
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
      const { data: body } = await this.http.get<unknown>(
        '/api/v1/feedbacks',
        {
          responseType: 'json',
          query: {
            isAnswered: false,
            take,
            skip,
            order: 'dateDesc',
          },
        },
      );

      const parsed = feedbacksResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new BadGatewayException(
          'Wildberries returned an invalid or unsuccessful response',
        );
      }

      return parsed.data.data;
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
