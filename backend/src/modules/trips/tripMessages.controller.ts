import type {Request,Response,NextFunction} from 'express';
import {tripMessages,sendTripMessage} from './tripMessages.service';
export async function history(req:Request,res:Response,next:NextFunction){try{res.json(await tripMessages(req.userId!,String(req.params.id),req.query.before));}catch(error){next(error);}}
export async function send(req:Request,res:Response,next:NextFunction){try{const result=await sendTripMessage(req.userId!,String(req.params.id),req.body);res.status(result.created?201:200).json(result);}catch(error){next(error);}}
