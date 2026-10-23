import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import * as customer from './customerCare.controller';
import {
  careList,
  careDetail,
  careCreate,
  careChange,
  supportSettingsRead,
  supportSettingsUpdate,
} from "./care.controller";
export const careAdminRouter = Router();
export const careCustomerRouter = Router();
careCustomerRouter.use(requireAuth);
careCustomerRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
careCustomerRouter.get('/settings', supportSettingsRead);
careCustomerRouter.get('/support', customer.list);
careCustomerRouter.post('/support', customer.create);
careCustomerRouter.get('/support/:id', customer.detail);
careCustomerRouter.post('/support/:id/messages', customer.reply);
careAdminRouter.use(requireAuth);
careAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
careAdminRouter.get('/support-settings', requireStaffRole('admin', 'super_admin'), supportSettingsRead);
careAdminRouter.patch('/support-settings', requireStaffRole('super_admin'), supportSettingsUpdate);
for (const kind of ["support", "safety"] as const) {
  const roles =
    kind === "safety"
      ? requireStaffRole("super_admin")
      : requireStaffRole("admin", "super_admin");
  careAdminRouter.get(`/${kind}`, roles, careList(kind));
  careAdminRouter.post(`/${kind}`, roles, careCreate(kind));
  careAdminRouter.get(`/${kind}/:id`, roles, careDetail(kind));
  careAdminRouter.post(`/${kind}/:id/activity`, roles, careChange(kind));
}
