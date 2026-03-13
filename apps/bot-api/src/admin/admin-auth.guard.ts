import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const configuredToken = process.env.ADMIN_API_TOKEN;

    if (!configuredToken) {
      throw new UnauthorizedException('ADMIN_API_TOKEN is not configured');
    }

    const authHeader = req.headers['authorization'] || '';
    const tokenFromHeader =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;

    if (!tokenFromHeader || tokenFromHeader !== configuredToken) {
      throw new UnauthorizedException('Invalid admin token');
    }

    return true;
  }
}
