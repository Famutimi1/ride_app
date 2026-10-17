import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { inTransaction } from "../config/db";
import { ApiError } from "../errors";
import { adminId } from "./adminQuery";

export const searchScopes = [
  "all",
  "people",
  "trips",
  "finance",
  "support",
  "safety",
] as const;
export type SearchScope = (typeof searchScopes)[number];
/** Bound database execution time as well as the number of returned records. */
export async function staffSearchRows<T extends QueryResultRow>(
  sql: string,
  values: unknown[],
): Promise<T[]> {
  try {
    return await inTransaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      return (await client.query<T>(sql, values)).rows;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "57014"
    )
      throw new ApiError(503, "staff_search_timed_out");
    throw error;
  }
}
export interface StaffSearchHit {
  id: string;
  type:
    | "person"
    | "trip"
    | "payment"
    | "withdrawal"
    | "account"
    | "support"
    | "safety";
  title: string;
  subtitle: string;
  href: string;
}
export interface SearchRead {
  query: string;
  prefix: string;
  scope: SearchScope;
  after: { id: string; type: StaffSearchHit["type"] } | null;
  limit: number;
}
const types: Record<
  Exclude<SearchScope, "all">,
  readonly StaffSearchHit["type"][]
> = {
  people: ["person"],
  trips: ["trip"],
  finance: ["payment", "withdrawal", "account"],
  support: ["support"],
  safety: ["safety"],
};
const context = (query: string, scope: string) =>
  createHash("sha256")
    .update(query + "\0" + scope)
    .digest("hex");
export function parseStaffSearch(body: unknown): SearchRead {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "invalid_search");
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["query", "scope", "cursor"].includes(key),
    )
  )
    throw new ApiError(400, "unsupported_search_field");
  if (typeof input.query !== "string")
    throw new ApiError(400, "invalid_search");
  const query = input.query.trim();
  if (query.length < 3 || query.length > 80 || /[\x00-\x1f\x7f]/.test(query))
    throw new ApiError(400, "search_requires_3_to_80_characters");
  const scope = input.scope ?? "all";
  if (typeof scope !== "string" || !searchScopes.includes(scope as SearchScope))
    throw new ApiError(400, "invalid_search_scope");
  let after: SearchRead["after"] = null;
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    input.cursor !== ""
  ) {
    try {
      if (
        scope === "all" ||
        typeof input.cursor !== "string" ||
        input.cursor.length > 512
      )
        throw new Error();
      const decoded: unknown = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString(),
      );
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("id" in decoded) ||
        !("type" in decoded) ||
        !("context" in decoded) ||
        decoded.context !== context(query, scope) ||
        typeof decoded.type !== "string" ||
        !types[scope as Exclude<SearchScope, "all">].includes(
          decoded.type as StaffSearchHit["type"],
        )
      )
        throw new Error();
      after = {
        id: adminId(decoded.id),
        type: decoded.type as StaffSearchHit["type"],
      };
    } catch {
      throw new ApiError(400, "invalid_search_cursor");
    }
  }
  return {
    query,
    prefix:
      query
        .toLowerCase()
        .replaceAll("!", "!!")
        .replaceAll("%", "!%")
        .replaceAll("_", "!_") + "%",
    scope: scope as SearchScope,
    after,
    limit: scope === "all" ? 5 : 20,
  };
}
export function staffSearchPage(
  scope: Exclude<SearchScope, "all">,
  label: string,
  rows: StaffSearchHit[],
  query: SearchRead,
) {
  const items = rows.slice(0, query.limit),
    last = items.at(-1),
    hasMore = rows.length > query.limit;
  return {
    scope,
    label,
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              id: last.id,
              type: last.type,
              context: context(query.query, scope),
            }),
          ).toString("base64url")
        : null,
  };
}
