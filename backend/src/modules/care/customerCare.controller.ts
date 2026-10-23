import type {Request,Response,NextFunction} from 'express';
import * as service from './customerCare.service';
const run=(fn:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{res.json(await fn(req));}catch(error){next(error);}};
export const list=run(req=>service.listCustomerCases(req.userId!,req.query.cursor));
export const detail=run(req=>service.customerCase(req.userId!,String(req.params.id),req.query.before));
export const create=run(req=>service.createCustomerCase(req.userId!,req.body));
export const reply=run(req=>service.replyCustomerCase(req.userId!,String(req.params.id),req.body));
