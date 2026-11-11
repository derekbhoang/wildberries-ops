import { Injectable } from '@nestjs/common';
import { HttpClient, InjectHttpClient } from '@nestjs/http-client';

@Injectable()
export class WildberriesService {
  constructor(
    @InjectHttpClient('wbFeedbacks')
    private readonly http: HttpClient,
  ) {}
}
