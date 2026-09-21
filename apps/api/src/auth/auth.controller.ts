import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: { username?: string; password?: string; displayName?: string }) {
    return this.authService.register(body.username ?? '', body.password ?? '', body.displayName);
  }

  @Post('login')
  login(@Body() body: { username?: string; password?: string }) {
    return this.authService.login(body.username ?? '', body.password ?? '');
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.authService.verifyToken(this.token(authorization));
  }

  private token(header?: string) { return header?.startsWith('Bearer ') ? header.slice(7) : undefined; }
}
