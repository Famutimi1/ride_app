import type { Request, Response, NextFunction } from "express";
import { adminLiveSnapshot, parseViewport } from "./admin.service";
export async function adminLive(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await adminLiveSnapshot(parseViewport(req.query), req.userId!));
  } catch (error) {
    next(error);
  }
}
