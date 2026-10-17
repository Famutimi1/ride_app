import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import { adminLive } from "./admin.controller";
export const locationAdminRouter = Router();
locationAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
locationAdminRouter.get(
  "/live",
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
  adminLive,
);
