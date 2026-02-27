import { Pool, type QueryResultRow } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const query = <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => pool.query<T>(text, params);
