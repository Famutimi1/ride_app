import { parseFinanceQuery, type FinanceQuery } from "./dashboard.service";
import type { Request, Response, NextFunction } from "express";
import { adminQuery, type AdminQuery } from "../../shared/utils/adminQuery";
import { ApiError } from "../../shared/errors";
export const dashboardList =
  (
    service: (query: FinanceQuery, actorId: string) => Promise<unknown>,
    statuses: readonly string[] = [],
    kind: "intents" | "withdrawals" | "accounts" = "accounts",
  ) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseFinanceQuery(req.query, kind, statuses);
      if (query.service) throw new ApiError(400, "unsupported_filter");
      res.json(await service(query, req.userId!));
    } catch (error) {
      next(error);
    }
  };
export const dashboardRead =
  (service: () => Promise<unknown>) =>
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service());
    } catch (error) {
      next(error);
    }
  };
