import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import bodyParser from "body-parser";


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Enable CORS for Next.js frontend
  app.enableCors({
    origin: ["http://localhost:3001"],
    credentials: true,
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  // ✅ Debug env (safe to keep in dev)
  console.log("JWT_ACCESS_SECRET present:", !!process.env.JWT_ACCESS_SECRET);
  console.log("JWT_REFRESH_SECRET present:", !!process.env.JWT_REFRESH_SECRET);
  console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);



app.use(
  bodyParser.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);


  await app.listen(port);

  console.log(`🚀 API running on http://localhost:${port}`);
}

bootstrap();