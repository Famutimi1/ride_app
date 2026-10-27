import type {Request,Response,NextFunction} from 'express';
import {sendTripMessage} from './tripMessages.service';
import {messageHistory} from '../communication/chat.service';
export async function history(req:Request,res:Response,next:NextFunction){try{res.json(await messageHistory(req.userId!,String(req.params.id),{before:req.query.before,afterSeq:req.query.afterSeq,throughSeq:req.query.throughSeq,limit:req.query.limit}));}catch(error){next(error);}}
export async function send(req:Request,res:Response,next:NextFunction){try{const result=await sendTripMessage(req.userId!,String(req.params.id),req.body);res.status(result.created?201:200).json(result);}catch(error){next(error);}}
