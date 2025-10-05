import roleControllers from "@/controllers/roleControllers.js";
import { authenticateUser } from "@/middleware/authenticateUser.js";
import { isAdmin } from "@/middleware/isAdmin.js";
import { Router } from "express";

const router: Router = Router();

router.get('/get-roles', authenticateUser, roleControllers.getRoles);
router.post('/create-role', authenticateUser, isAdmin, roleControllers.createRole)
router.delete('/delete-role', authenticateUser, isAdmin, roleControllers.deleteRole)

export default router;