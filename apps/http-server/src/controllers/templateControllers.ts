import { Request, Response } from "express";
import { prismaClient } from '@repo/db/db'
import templateRepo from "../repository/templateRepo.js";

class Templates {
    async getTemplates(req: Request, res: Response) {
        try {
            if (!req?.user) {
                return res.status(400).json({
                    success: false,
                    data: `User Not Authenticated!!!`,
                    message: "User Not Authenticated!!!"
                })
            }

            const allTemplates = await templateRepo.getAllTemplates(req.user.user_id)

        } catch (error) {
            return res.status(500).json({
                success: false,
                data: `${error}`,
                message: "Something Went Wrong!!!"
            })
        }
    }
}

export default new Templates();




// try {
//     if (!req?.user) {
//         return res.status(400).json({
//             success: false,
//             data: `User Not Authenticated!!!`,
//             message: "User Not Authenticated!!!"
//         })
//     }

//     // const allTemplates = await

// } catch (error) {
//     return res.status(500).json({
//         success: false,
//         data: `${error}`,
//         message: "Something Went Wrong!!!"
//     })
// }