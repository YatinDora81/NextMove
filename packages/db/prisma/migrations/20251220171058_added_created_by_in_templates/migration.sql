-- CreateEnum
CREATE TYPE "public"."CreatedBy" AS ENUM ('AI', 'SELF');

-- AlterTable
ALTER TABLE "public"."Templates" ADD COLUMN     "createdBy" "public"."CreatedBy" NOT NULL DEFAULT 'SELF';
