import "express";
import type { SessionUser } from "../types.js";

declare global {
  namespace Express {
    interface User extends SessionUser {}
  }
}

export {};
