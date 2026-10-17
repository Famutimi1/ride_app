import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import {
  adminApplicationDetail,
  adminApplicationDocument,
  adminApplicationReview,
} from "./admin.controller";
export const driverAdminRouter = Router();
driverAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
driverAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
driverAdminRouter.get("/driver-applications/:id", adminApplicationDetail);
driverAdminRouter.get(
  "/driver-applications/:id/documents/:kind",
  adminApplicationDocument,
);
driverAdminRouter.post(
  "/driver-applications/:id/review",
  adminApplicationReview,
);
