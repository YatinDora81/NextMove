import { NextFunction, Request, Response } from "express";

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                data: 'User not authenticated',
                message: "User is not authenticated"
            })
        }

        const admins = process.env.ADMIN_EMAILS || [] as string[];
        if (!admins.includes(user.email)) {
            return res.status(401).json({
                success: false,
                data: 'User is not admin',
                message: "User is not admin"
            })
        }
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            data: error,
            message: "Internal Server Error"
        })
    }

}