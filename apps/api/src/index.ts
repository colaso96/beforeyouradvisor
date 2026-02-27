import express from "express";
import session from "express-session";
import cors from "cors";
import passport from "./auth/passport.js";
import { env } from "./config/env.js";
import { ensureSchema } from "./db/schema.js";
import { authRouter } from "./routes/authRoutes.js";
import { apiRouter } from "./routes/apiRoutes.js";

const app = express();

app.use(express.json());
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
