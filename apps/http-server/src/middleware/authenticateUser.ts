import { authTokenSchemaType } from "@repo/types/ZodTypes";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

declare global {
    namespace Express {
        export interface Request {
            user?: authTokenSchemaType;
        }
    }
}

export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
    try {
        // Check for token in Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({
                success: false,
                message: "User Not Authenticated! No token provided."
            });
            return 
        }

        const token = authHeader.split(" ")[1];

        try {
            // Verify token using JWT secret
            const decoded = jwt.verify(token!, process.env.JWT_SECRET!) as unknown as authTokenSchemaType;

            // Attach user info to request object
            req.user = decoded;

            // Proceed to next middleware or route handler
            next();
        } catch (error: any) {
            console.error("JWT Error:", error);

            if (error.name === "TokenExpiredError") {
                res.status(401).json({
                    success: false,
                    error: "Token expired",
                    message: "Your session has expired. Please login again."
                });
                return 
            } else if (error.name === "JsonWebTokenError") {
                res.status(401).json({
                    success: false,
                    error: "Invalid token",
                    message: "The provided token is invalid."
                });
                return 
            } else {
                res.status(500).json({
                    success: false,
                    error: "Internal server error",
                    message: "Something went wrong while verifying the token."
                });
                return 
            }
        }

    } catch (error) {
        console.error("Authentication middleware error:", error);
        res.status(500).json({
            success: false,
            message: "User Not Authenticated!"
        });
        return 
    }
};
