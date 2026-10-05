import type { NextFunction, Request, Response } from 'express';
import { inTransaction } from '../../shared/config/db';
import * as driver from './driver.service';
const run = (handler: (req: Request) => Promise<unknown>) => async (req: Request,res: Response,next: NextFunction) => { try { res.json(await handler(req)); } catch(error) { next(error); } };
export const personalInfo=run((req)=>inTransaction((client)=>driver.savePersonalInfo(req.userId!,req.body,client)));
export const vehicleInfo=run((req)=>inTransaction((client)=>driver.saveVehicleInfo(req.userId!,req.body,client)));
export const documents=run((req)=>inTransaction((client)=>driver.saveDocuments(req.userId!,req.files as Record<string,Express.Multer.File[]>,client)));
export const submit=run((req)=>inTransaction((client)=>driver.submitApplication(req.userId!,client)));
export const status=run((req)=>inTransaction((client)=>driver.applicationStatus(req.userId!,client)));
