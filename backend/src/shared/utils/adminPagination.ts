import type { QueryResultRow } from "pg";
import { db, inTransaction } from "../config/db";
import { ApiError } from "../errors";

export interface AdminPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
export interface AdminPagingResult {
  total?: number;
  pagination?: AdminPagination;
}
export function paginationMeta(
  page: number,
  pageSize: number,
  total: number,
): AdminPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  return {
    page: current,
    pageSize,
    total,
    totalPages,
    from: total ? (current - 1) * pageSize + 1 : 0,
    to: Math.min(current * pageSize, total),
    hasPrevious: current > 1,
    hasNext: current < totalPages,
  };
}
/** SQL identifiers/order expressions come from fixed domain definitions, never request text. */
export async function readAdminRows<T extends QueryResultRow = QueryResultRow>(
  sql: { select: string; orderBy: string; limitParameter: number },
  values: unknown[],
  query: { page?: number | null; limit: number },
): Promise<{ rows: T[] } & AdminPagingResult> {
  const limit = `$${sql.limitParameter}`;
  if (query.page == null)
    return {
      rows: (
        await db.query<T>(
          `${sql.select} ORDER BY ${sql.orderBy} LIMIT ${limit}`,
          values,
        )
      ).rows,
    };
  try {
    return await inTransaction(async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      // The limit placeholder is explicitly typed even when it is between filter parameters.
      const counted = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM (${sql.select}) matching WHERE ${limit}::int >= 1`,
        values,
      );
      const total = Number(counted.rows[0].total);
      if (!Number.isSafeInteger(total) || total < 0)
        throw new ApiError(503, "pagination_count_unavailable");
      const pagination = paginationMeta(query.page!, query.limit, total);
      const pageValues = [...values, (pagination.page - 1) * query.limit];
      pageValues[sql.limitParameter - 1] = query.limit;
      const rows = (
        await client.query<T>(
          `${sql.select} ORDER BY ${sql.orderBy} LIMIT ${limit} OFFSET $${pageValues.length}`,
          pageValues,
        )
      ).rows;
      return { rows, total, pagination };
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "57014"
    )
      throw new ApiError(503, "pagination_unavailable");
    throw error;
  }
}
