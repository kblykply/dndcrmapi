import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class PaymentTrackingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: string; originalRole?: string; isPreview?: boolean };
    }>();
    if (!request.user?.role)
      throw new UnauthorizedException('User role not found');
    if (
      !['ADMIN', 'ACCOUNTING'].includes(request.user.role) ||
      request.user.originalRole === 'PREVIEW' ||
      request.user.isPreview
    )
      throw new ForbiddenException(
        'Satış takibi yalnız yönetici ve muhasebe hesaplarına açıktır.',
      );
    return true;
  }
}
