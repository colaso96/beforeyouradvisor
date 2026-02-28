import express from "express";
import session from "express-session";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import passport from "./auth/passport.js";
import { env } from "./config/env.js";
import { ensureSchema } from "./db/schema.js";
import { authRouter } from "./routes/authRoutes.js";
import { apiRouter } from "./routes/apiRoutes.js";

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
const webDistPath = resolve(currentDir, "../../web/dist");

app.use(express.json());
app.set("trust proxy", 1);
app.use(
  cors({
    origin: env.APP_ORIGIN,
    credentials: true,
  }),
);
app.use(
  session({
    name: "writeoffs.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/api", apiRouter);

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/") || req.path === "/auth" || req.path.startsWith("/auth/")) {
      next();
      return;
    }
    res.sendFile(resolve(webDistPath, "index.html"));
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});

async function bootstrap(): Promise<void> {
  await ensureSchema();
  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

void bootstrap();
