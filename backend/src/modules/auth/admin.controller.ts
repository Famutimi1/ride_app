import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import { adminId, adminQuery } from "../../shared/utils/adminQuery";
import {
  getAdminPerson,
  listAdminPeople,
  updateAdminPerson,
} from "./admin.service";
export const adminPeopleList =
  (driversOnly: boolean) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = adminQuery(
        req.query,
        ["pending", "approved", "rejected"],
        ["active", "inactive"],
      );
      if (query.service && !driversOnly) throw new ApiError(400, "unsupported_filter");
      res.json(await listAdminPeople(query, driversOnly));
    } catch (error) {
      next(error);
    }
  };
export async function adminPersonDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminPerson(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}

export async function adminRecordSearch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { parseStaffSearch } =
      await import("../../shared/utils/adminSearch.js");
    const { searchStaffRecords } = await import("./admin.service.js");
    res.json(
      await searchStaffRecords(
        parseStaffSearch(req.body),
        req.userId!,
        req.authUser!.role,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminPersonUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(
      await updateAdminPerson(req.userId!, adminId(req.params.id), req.body),
    );
  } catch (error) {
    next(error);
  }
}
