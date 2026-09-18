import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApiExceptionFilter } from './../src/common/filters/api-exception.filter';
import { ApiResponseInterceptor } from './../src/common/interceptors/api-response.interceptor';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({
        code: 0,
        data: 'Hello World!',
        msg: 'success',
      });
  });

  it('/agents/missing (GET)', () => {
    return request(app.getHttpServer())
      .get('/agents/missing')
      .expect(404)
      .expect({
        code: 404,
        data: null,
        msg: 'Agent "missing" does not exist.',
        error: 'AGENT_NOT_FOUND',
      });
  });

  it('/models/missing (GET)', () => {
    return request(app.getHttpServer())
      .get('/models/missing')
      .expect(404)
      .expect({
        code: 404,
        data: null,
        msg: 'Model "missing" does not exist.',
        error: 'MODEL_NOT_FOUND',
      });
  });

  it('/tools/missing (GET)', () => {
    return request(app.getHttpServer())
      .get('/tools/missing')
      .expect(404)
      .expect({
        code: 404,
        data: null,
        msg: 'Tool "missing" does not exist.',
        error: 'TOOL_NOT_FOUND',
      });
  });
});
