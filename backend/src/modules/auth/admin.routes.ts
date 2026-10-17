import {
  getAdminHealth,
  getAdminTeam,
  getAdminEnvironment,
} from "./admin.service";
import { Router } from "express";
import { adminQuery } from "../../shared/utils/adminQuery";
import { requireAuth, requireStaffRole } from "./auth.middleware";
import {
  adminPeopleList,
  adminPersonDetail,
  adminPersonUpdate,
  adminRecordSearch,
} from "./admin.controller";
export const peopleAdminRouter = Router();
peopleAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
peopleAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
peopleAdminRouter.post("/search", adminRecordSearch);
peopleAdminRouter.get("/users", adminPeopleList(false));
peopleAdminRouter.get("/users/:id", adminPersonDetail);
peopleAdminRouter.patch(
  "/users/:id",
  requireStaffRole("super_admin"),
  adminPersonUpdate,
);
peopleAdminRouter.get("/drivers", adminPeopleList(true));
peopleAdminRouter.get("/drivers/:id", adminPersonDetail);
peopleAdminRouter.get("/driver-applications", adminPeopleList(true));

peopleAdminRouter.get("/health", async (_req, res, next) => {
  try {
    res.json(await getAdminHealth());
  } catch (error) {
    next(error);
  }
});

peopleAdminRouter.get(
  "/team",
  requireStaffRole("super_admin"),
  async (req, res, next) => {
    try {
      res.json(
        await getAdminTeam(adminQuery(req.query, ["admin", "super_admin"])),
      );
    } catch (error) {
      next(error);
    }
  },
);

peopleAdminRouter.get("/environment", (_req, res) =>
  res.json(getAdminEnvironment()),
);
