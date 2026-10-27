import type { NextFunction, Request, Response } from 'express';
import { getCommunication, recordReceipt } from './communication.service';

export async function detail(req: Request,res: Response,next: NextFunction) {
  try { res.json(await getCommunication(req.userId!,String(req.params.id))); } catch(error) { next(error); }
}
export async function receipt(req: Request,res: Response,next: NextFunction) {
  try { res.json(await recordReceipt(req.userId!,String(req.params.id),req.body)); } catch(error) { next(error); }
}
