import {
  getAdminIntent,
  getAdminWithdrawal,
  reconciliationExceptions,
  listAdminWebhookExceptions,
} from "./dashboard.service";
import { adminQuery } from "../../shared/utils/adminQuery";
import { adminId, entryPageQuery } from "../../shared/utils/adminQuery";
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import { dashboardList, dashboardRead } from "./dashboard.controller";
import {
  getAdminAccount,
  getAdminTransaction,
  refundEligibility,
  adminOperationStatus,
  getAdminAudit,
  auditQuery,
  getAdminReconciliation,
  listAdminAccounts,
  listAdminIntents,
  listAdminWithdrawals,
} from "./dashboard.service";
export const financeDashboardRouter = Router();
financeDashboardRouter.use(
  requireAuth,
  requireStaffRole("admin", "super_admin"),
);
financeDashboardRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
financeDashboardRouter.get(
  "/payment-intents",
  dashboardList(
    listAdminIntents,
    ["pending", "succeeded", "failed", "abandoned", "mismatch"],
    "intents",
  ),
);
financeDashboardRouter.get(
  "/withdrawals",
  dashboardList(
    listAdminWithdrawals,
    ["pending", "processing", "success", "failed", "reversed"],
    "withdrawals",
  ),
);
financeDashboardRouter.get("/accounts", dashboardList(listAdminAccounts));
financeDashboardRouter.get(
  "/reconciliation",
  dashboardRead(getAdminReconciliation),
);
financeDashboardRouter.get("/audit", async (req, res, next) => {
  try {
    res.json(await getAdminAudit(auditQuery(req.query), req.authUser!.role));
  } catch (error) {
    next(error);
  }
});

financeDashboardRouter.get("/accounts/:id", async (req, res, next) => {
  try {
    res.json(
      await getAdminAccount(
        adminId(req.params.id),
        entryPageQuery(req.query),
        req.userId!,
      ),
    );
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/transactions/:id", async (req, res, next) => {
  try {
    res.json(await getAdminTransaction(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get(
  "/refund-eligibility/:id",
  async (req, res, next) => {
    try {
      res.json(await refundEligibility(adminId(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);
financeDashboardRouter.get("/operations/:key", async (req, res, next) => {
  try {
    res.json(await adminOperationStatus(req.userId!, adminId(req.params.key)));
  } catch (error) {
    next(error);
  }
});

financeDashboardRouter.get("/payment-intents/:id", async (req, res, next) => {
  try {
    res.json(await getAdminIntent(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/withdrawals/:id", async (req, res, next) => {
  try {
    res.json(await getAdminWithdrawal(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/reconciliation/:kind", async (req, res, next) => {
  try {
    res.json(
      req.params.kind === "webhooks" ? await listAdminWebhookExceptions(entryPageQuery(req.query), req.userId!) : await reconciliationExceptions(
        String(req.params.kind),
        adminQuery(req.query),
        req.userId!,
      ),
    );
  } catch (error) {
    next(error);
  }
});
