import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import {
  adminId,
  adminQuery,
  entryPageQuery,
} from "../../shared/utils/adminQuery";
import {
  careStatuses,
  listCare,
  getCare,
  createCare,
  changeCare,
  type CareKind,
  getSupportSettings,
  updateSupportSettings,
} from "./care.service";
const body = (req: Request): Record<string, unknown> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new ApiError(400, "invalid_body");
  return req.body;
};
export async function supportSettingsRead(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await getSupportSettings()); } catch (error) { next(error); }
}
export async function supportSettingsUpdate(req: Request, res: Response, next: NextFunction) {
  try { res.json(await updateSupportSettings(req.userId!, body(req))); } catch (error) { next(error); }
}
export const careList =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.query.service || req.query.mode)
        throw new ApiError(400, "unsupported_filter");
      res.json(await listCare(kind, adminQuery(req.query, careStatuses(kind))));
    } catch (error) {
      next(error);
    }
  };
export const careDetail =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.query.page !== undefined)
        throw new ApiError(400, "unsupported_filter");
      res.json(
        await getCare(
          req.userId!,
          kind,
          adminId(req.params.id),
          entryPageQuery(req.query).before,
        ),
      );
    } catch (error) {
      next(error);
    }
  };
export const careCreate =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await createCare(req.userId!, kind, body(req)));
    } catch (error) {
      next(error);
    }
  };
export const careChange =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await changeCare(req.userId!, kind, adminId(req.params.id), body(req)),
      );
    } catch (error) {
      next(error);
    }
  };
