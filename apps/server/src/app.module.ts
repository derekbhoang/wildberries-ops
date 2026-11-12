import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { WildberriesModule } from './wildberries/wildberries.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      skipProcessEnv: true,
      validate: validateEnv,
    }),
    WildberriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
