import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  feedbackIdSchema,
  type FeedbackDraft,
} from '@wildberries-ops/contracts';
import { FeedbackDraftsService } from './feedback-drafts.service.js';

@Controller('feedbacks')
@UseGuards(ThrottlerGuard)
@UsePipes(new StandardSchemaValidationPipe())
export class FeedbackDraftsController {
  constructor(private readonly feedbackDrafts: FeedbackDraftsService) {}

  @Post(':id/draft')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  generate(
    @Param('id', { schema: feedbackIdSchema }) id: string,
  ): Promise<FeedbackDraft> {
    return this.feedbackDrafts.generate(id);
  }
}
