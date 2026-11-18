import { createOpenAI } from '@ai-sdk/openai';
import { AiModule } from '@nestjs/ai';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { WildberriesModule } from '../wildberries/wildberries.module.js';
import { FeedbackDraftsController } from './feedback-drafts.controller.js';
import { FeedbackDraftsService } from './feedback-drafts.service.js';
import { ReviewReplyGeneratorService } from './review-reply-generator.service.js';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    WildberriesModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
      getTracker: () => 'configured-seller',
    }),
    AiModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const openai = createOpenAI({
          apiKey: config.get('OPENAI_API_KEY', { infer: true }),
        });

        return {
          models: {
            reviewReply: openai(
              config.get('OPENAI_REPLY_MODEL', { infer: true }),
            ),
          },
          defaults: {
            timeout: '15s',
            retry: false,
            maxOutputTokens: 1000,
          },
          include: [],
        };
      },
    }),
  ],
  controllers: [FeedbackDraftsController],
  providers: [FeedbackDraftsService, ReviewReplyGeneratorService],
})
export class FeedbackDraftsModule {}
