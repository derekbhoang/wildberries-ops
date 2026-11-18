import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import type { Env } from '../config/env.validation.js';
import { WildberriesService } from './wildberries.service.js';
import { FeedbacksController } from './feedbacks.controller.js';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: 'wbFeedbacks',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        headers: {
          Authorization: config.get('WB_API_KEY', { infer: true }),
        },
        timeout: 10_000,
        retry: false,
      }),
    }),
  ],
  controllers: [FeedbacksController],
  providers: [WildberriesService],
  exports: [WildberriesService],
})
export class WildberriesModule {}
