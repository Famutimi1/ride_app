import { ApiError } from "../errors";
export interface AdminQuery {
  page?: number | null;
  limit: number;
  cursor: { at: string; id: string } | null;
  status: string | null;
  service: string | null;
  mode: string | null;
  id: string | null;
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function adminId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new ApiError(400, "invalid_id");
  return value;
}
export function adminQuery(
  input: Record<string, unknown>,
  statuses: readonly string[] = [],
  modes: readonly string[] = [],
): AdminQuery {
  for (const key of Object.keys(input))
    if (
      !["page", "limit", "cursor", "status", "service", "mode", "id"].includes(
        key,
      )
    )
      throw new ApiError(400, "unsupported_filter");
  const text = (name: string) => {
    const value = input[name];
    if (value === undefined || value === "") return null;
    if (typeof value !== "string") throw new ApiError(400, "invalid_filter");
    return value;
  };
  const size = text("limit");
  if (size && !/^\d+$/.test(size)) throw new ApiError(400, "invalid_limit");
  const page = adminPageNumber(input.page);
  const limit = size ? Number(size) : page === null ? 50 : 20;
  if (limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit");
  const status = text("status"),
    service = text("service"),
    mode = text("mode"),
    id = text("id");
  if (
    (status && !statuses.includes(status)) ||
    (service && !["ride", "courier"].includes(service)) ||
    (mode && !modes.includes(mode))
  )
    throw new ApiError(400, "invalid_filter");
  let cursor: AdminQuery["cursor"] = null;
  const encoded = text("cursor");
  if (page !== null && encoded)
    throw new ApiError(400, "page_and_cursor_are_exclusive");
  if (encoded) {
    try {
      if (encoded.length > 512) throw new Error();
      const decoded: unknown = JSON.parse(
        Buffer.from(encoded, "base64url").toString(),
      );
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("at" in decoded) ||
        !("id" in decoded) ||
        typeof decoded.at !== "string" ||
        !Number.isFinite(Date.parse(decoded.at)) ||
        typeof decoded.id !== "string" ||
        !uuidPattern.test(decoded.id)
      )
        throw new Error();
      cursor = { at: decoded.at, id: decoded.id };
    } catch {
      throw new ApiError(400, "invalid_cursor");
    }
  }
  return {
    page,
    limit,
    cursor,
    status,
    service,
    mode,
    id: id ? adminId(id) : null,
  };
}
export function adminPage<T extends { id: string; _cursor: string }>(
  rows: T[],
  query: AdminQuery,
  dateBasis: string,
  paging?: {
    total?: number;
    pagination?: import("./adminPagination").AdminPagination;
  },
) {
  const hasMore = rows.length > query.limit;
  const visible = rows.slice(0, query.limit);
  const last = visible.at(-1);
  return {
    items: visible.map(({ _cursor, ...row }) => row),
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ at: last._cursor, id: last.id }),
          ).toString("base64url")
        : null,
    asOf: new Date().toISOString(),
    scope: {
      dateBasis,
      status: query.status,
      service: query.service,
      mode: query.mode,
    },
    pagination: paging?.pagination,
    count: {
      value: paging?.total ?? visible.length,
      exact: paging?.total !== undefined || (!hasMore && !query.cursor),
    },
  };
}
export function maskedPhone(value: string | null): string {
  return value ? `••• ${value.slice(-4)}` : "Not supplied";
}
export function maskedEmail(value: string | null): string {
  return value ? `${value.slice(0, 1)}•••@•••` : "Not supplied";
}

export function entryPageQuery(input: Record<string, unknown>): {
  page: number | null;
  before: string | null;
  limit: number;
} {
  for (const key of Object.keys(input))
    if (!["page", "before", "limit"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const before = input.before === undefined ? null : input.before;
  if (
    before !== null &&
    (typeof before !== "string" ||
      !/^\d+$/.test(before) ||
      BigInt(before) <= 0n ||
      BigInt(before) > 9223372036854775807n)
  )
    throw new ApiError(400, "invalid_cursor");
  const page = adminPageNumber(input.page);
  if (page !== null && before !== null)
    throw new ApiError(400, "page_and_cursor_are_exclusive");
  const limit =
    input.limit === undefined ? (page === null ? 50 : 20) : Number(input.limit);
  if (
    (input.limit !== undefined &&
      (typeof input.limit !== "string" || !/^\d+$/.test(input.limit))) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ApiError(400, "invalid_limit");
  return { page, before: before as string | null, limit };
}
export function adminPageNumber(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value))
    throw new ApiError(400, "invalid_page");
  return Number(value);
}
