import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import { adminId } from "../../shared/utils/adminQuery";
import {
  documentKinds,
  getAdminApplication,
  readAdminDocument,
  reviewAdminApplication,
  type DocumentKind,
} from "./admin.service";
export async function adminApplicationDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminApplication(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
export async function adminApplicationReview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(
      await reviewAdminApplication(
        req.userId!,
        adminId(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminApplicationDocument(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const kind = req.params.kind;
    if (
      typeof kind !== "string" ||
      !documentKinds.includes(kind as DocumentKind)
    )
      throw new ApiError(400, "invalid_document_kind");
    const document = await readAdminDocument(
      req.userId!,
      adminId(req.params.id),
      kind as DocumentKind,
    );
    res
      .set({
        "Content-Type": document.contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      })
      .send(document.bytes);
  } catch (error) {
    next(error);
  }
}
