import type { Request, Response, NextFunction } from "express";
import { adminId, adminQuery } from "../../shared/utils/adminQuery";
import {
  adminTripStatuses,
  parseAdminTripQuery,
  getAdminOverview,
  getAdminTrip,
  getAdminTripPosition,
  listAdminTrips,
} from "./admin.service";
export async function adminTripList(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await listAdminTrips(parseAdminTripQuery(req.query)));
  } catch (error) {
    next(error);
  }
}
export async function adminTripDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminTrip(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
export async function adminOverview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (
      Object.keys(req.query).some((k) => k !== "day") ||
      (req.query.day !== undefined && typeof req.query.day !== "string")
    )
      throw new (await import("../../shared/errors.js")).ApiError(
        400,
        "invalid_overview_filter",
      );
    res.json(
      await getAdminOverview(
        req.authUser!.role,
        req.query.day as string | undefined,
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function adminReports(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { getAdminReports, reportRange } = await import("./admin.service.js");
    res.json(await getAdminReports(reportRange(req.query)));
  } catch (error) {
    next(error);
  }
}
export async function adminPricing(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { getAdminPricing } = await import("./admin.service.js");
    res.json(await getAdminPricing());
  } catch (error) {
    next(error);
  }
}
export async function adminPricingUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { updateAdminPricing } = await import("./admin.service.js");
    res.json(
      await updateAdminPricing(
        req.userId!,
        String(req.params.vehicleType),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminScheduleUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { updateAdminSchedule } = await import("./admin.service.js");
    res.json(
      await updateAdminSchedule(req.userId!, adminId(req.params.id), req.body),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminRatings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { listAdminRatings } = await import("./admin.service.js");
    res.json(await listAdminRatings(adminQuery(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function adminTripPosition(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminTripPosition(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
