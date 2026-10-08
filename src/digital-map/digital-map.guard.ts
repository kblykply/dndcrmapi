import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

export type DigitalMapUser = {
  id: string;
  role: string;
  originalRole?: string;
  isPreview?: boolean;
};

export function assertDigitalMapIdentity(
  user?: DigitalMapUser,
): asserts user is DigitalMapUser {
  if (!user?.id || !user.role)
    throw new UnauthorizedException('Please sign in.');
  if (
    user.isPreview ||
    user.originalRole === 'PREVIEW' ||
    user.role !== 'ADMIN'
  ) {
    throw new ForbiddenException(
      'Digital map is restricted to administrator accounts.',
    );
  }
}

/** Runs before the global interceptor can rewrite a preview identity. */
@Injectable()
export class DigitalMapGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: DigitalMapUser }>();
    assertDigitalMapIdentity(request.user);
    return true;
  }
}
