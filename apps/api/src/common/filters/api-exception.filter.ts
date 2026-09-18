import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response.headersSent || response.writableEnded) {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.resolveMessage(exception);
    const error = this.resolveError(exception, status);

    const body: ApiResponse<null> = {
      code: status,
      data: null,
      msg: message,
      error,
    };

    response.status(status).json(body);
  }

  private resolveMessage(exception: unknown): string {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
    ) {
      const { message } = exceptionResponse as { message: unknown };

      if (Array.isArray(message)) {
        return message.join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  private resolveError(exception: unknown, status: number): string {
    const mappedError = this.mapErrorByStatus(status);

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'error' in exceptionResponse &&
        typeof exceptionResponse.error === 'string' &&
        exceptionResponse.error.trim() &&
        exceptionResponse.error !== this.defaultStatusText(status)
      ) {
        return exceptionResponse.error;
      }
    }

    return mappedError;
  }

  private mapErrorByStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }

  private defaultStatusText(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      default:
        return 'Internal Server Error';
    }
  }
}
