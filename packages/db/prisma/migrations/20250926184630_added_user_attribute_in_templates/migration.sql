/*
  Warnings:

  - Added the required column `user` to the `Templates` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Templates" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "user" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."Templates" ADD CONSTRAINT "Templates_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
