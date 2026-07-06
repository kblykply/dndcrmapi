import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { map } from "rxjs";

@Injectable()
export class PreviewDataInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const path = String(req.path || req.url || "");

    if (req.user?.role !== "PREVIEW" || path === "/health" || path.startsWith("/auth")) {
      return next.handle();
    }

    if (req.method !== "GET") {
      throw new ForbiddenException("Preview accounts are read-only");
    }

    req.user = {
      ...req.user,
      originalRole: req.user.role,
      role: "ADMIN",
      isPreview: true,
    };

    return next.handle().pipe(map((data) => this.scrub(data)));
  }

  private scrub(value: any): any {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return [];
    if (value instanceof Date) return null;

    if (typeof value === "number") return 0;
    if (typeof value === "bigint") return 0;
    if (typeof value === "boolean") return false;
    if (typeof value === "string") return "";

    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, this.scrub(child)]),
      );
    }

    return null;
  }
}
