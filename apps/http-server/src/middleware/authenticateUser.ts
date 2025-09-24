import { NextFunction, Request, Response } from "express";

// export interface AuthenticatedRequest extends Request {
//   user?: AuthUser;
//   user?: any;
//   apiKey?: string;
// }

declare global{
    namespace Express{
        export interface Request{
            user ?:{
                id : string,
                fullname : string,
                email : string
            }
        }
    }
}

export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
    try {
        req.user = {
            id : "",
            fullname : "",
            email : ""
        }
        next();
    } catch (error) {
        res.status(500).json({
            success : false,
            data : "User Not Authenticated!!!",
            message : "User Not Authenticated!!!"
        })
    }
}