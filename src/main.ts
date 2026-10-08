import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import bodyParser from "body-parser";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { PreviewDataInterceptor } from "./common/preview-data.interceptor";
import { DatabaseExceptionFilter } from "./common/database-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new PreviewDataInterceptor());
  app.useGlobalFilters(new DatabaseExceptionFilter());

  app.enableCors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "https://dndcrmweb.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // Project aggregates may contain bounded workstreams and external factors.
  // Parse only this module up to 1 MiB before the existing default JSON parser.
  app.use('/digital-team', bodyParser.json({ limit: '1mb' }));

  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads/",
  });

  // ✅ FIX (TypeScript issue solved)
  app.getHttpAdapter().get("/health", (_req, res) => {
    (res as any).json({ ok: true });
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  console.log("JWT_ACCESS_SECRET present:", !!process.env.JWT_ACCESS_SECRET);
  console.log("JWT_REFRESH_SECRET present:", !!process.env.JWT_REFRESH_SECRET);
  console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);

  await app.listen(port);

  console.log(`🚀 API running on port ${port}`);
  console.log(`✅ Health: /health`);
  console.log(`📁 Uploads served at: /uploads`);
}

bootstrap();
