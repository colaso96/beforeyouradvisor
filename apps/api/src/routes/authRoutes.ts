import { Router } from "express";
import passport from "passport";
import { env } from "../config/env.js";

export const authRouter = Router();

authRouter.get(
  "/google",
  passport.authenticate("google", {
    scope: ["openid", "profile", "email", "https://www.googleapis.com/auth/drive.readonly"],
    accessType: "offline",
    prompt: "consent",
  }),
);

authRouter.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${env.APP_ORIGIN}/?auth=failed`, session: true }),
  (_req, res) => {
    res.redirect(`${env.APP_ORIGIN}/ingest`);
  },
);

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("writeoffs.sid");
      res.status(204).send();
    });
  });
});
