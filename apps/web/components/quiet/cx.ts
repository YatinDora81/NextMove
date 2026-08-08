import type { ClassValue } from "clsx"
import { cn } from "@/lib/utils"

export const cx = (...classes: ClassValue[]) => cn(...classes)
