import { exportAdminReports, reportRange } from "./admin.service";
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import {
  adminReports,
  adminPricing,
  adminPricingUpdate,
  adminScheduleUpdate,
  adminRatings,
  adminOverview,
  adminTripDetail,
  adminTripPosition,
  adminTripList,
} from "./admin.controller";
export const tripAdminRouter = Router();
tripAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
tripAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
tripAdminRouter.get("/overview", adminOverview);
tripAdminRouter.get("/trips", adminTripList);
tripAdminRouter.get("/trips/:id", adminTripDetail);
tripAdminRouter.post(
  "/trips/:id/schedule",
  requireStaffRole("super_admin"),
  adminScheduleUpdate,
);
tripAdminRouter.get("/trips/:id/location", adminTripPosition);

tripAdminRouter.get("/reports", adminReports);
tripAdminRouter.get("/pricing", adminPricing);
tripAdminRouter.patch(
  "/pricing/:vehicleType",
  requireStaffRole("super_admin"),
  adminPricingUpdate,
);
tripAdminRouter.get("/ratings", adminRatings);

tripAdminRouter.get("/reports/export", async (req, res, next) => {
  try {
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=rakky-report.csv",
      })
      .send(await exportAdminReports(req.userId!, reportRange(req.query)));
  } catch (error) {
    next(error);
  }
});
