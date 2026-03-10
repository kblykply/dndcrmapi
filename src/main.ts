import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import bodyParser from "body-parser";
import { ValidationPipe } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // CORS for local + Vercel frontend
  app.enableCors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://dndcrmweb.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // Keep raw body for future Meta signature verification
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Health endpoint
  app.getHttpAdapter().get("/health", (_req, res) => {
    res.send({ ok: true });
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Debug env (fine for now)
  console.log("JWT_ACCESS_SECRET present:", !!process.env.JWT_ACCESS_SECRET);
  console.log("JWT_REFRESH_SECRET present:", !!process.env.JWT_REFRESH_SECRET);
  console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);

  await app.listen(port);

  console.log(`🚀 API running on port ${port}`);
  console.log(`✅ Health: /health`);
}

bootstrap();