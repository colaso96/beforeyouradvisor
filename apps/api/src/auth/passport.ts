import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { query } from "../db/client.js";
import type { SessionUser } from "../types.js";

type DbUser = { id: string; email: string };

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken: string, _refreshToken: string, profile: Profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("Google profile email is missing"));
        }

        const existing = await query<DbUser>("SELECT id, email FROM users WHERE google_id = $1", [profile.id]);
        if (existing.rowCount && existing.rows[0]) {
          return done(null, {
            id: existing.rows[0].id,
            email: existing.rows[0].email,
            accessToken,
          } satisfies SessionUser);
        }

        const created = await query<DbUser>(
          `INSERT INTO users (id, google_id, email)
           VALUES ($1, $2, $3)
           RETURNING id, email`,
          [randomUUID(), profile.id, email],
        );

        return done(null, { id: created.rows[0].id, email: created.rows[0].email, accessToken } satisfies SessionUser);
      } catch (error) {
        return done(error as Error);
      }
    },
  ),
);

passport.serializeUser((user: Express.User, done) => {
  done(null, user as SessionUser);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user as SessionUser);
});

export default passport;
