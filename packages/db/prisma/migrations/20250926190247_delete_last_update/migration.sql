/*
  Warnings:

  - You are about to drop the `_User_Roles` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."_User_Roles" DROP CONSTRAINT "_User_Roles_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_User_Roles" DROP CONSTRAINT "_User_Roles_B_fkey";

-- DropTable
DROP TABLE "public"."_User_Roles";
