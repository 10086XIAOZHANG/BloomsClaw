import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

const whiteList = ['/models-streaming'];

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const args = _context.switchToHttp().getRequest();
    if (whiteList.includes(args.url)) {
      return next.handle() as Observable<ApiResponse<T>>;
    } else {
      return next.handle().pipe(
        map((data) => ({
          code: 0,
          data,
          msg: 'success',
        })),
      );
    }
  }
}
