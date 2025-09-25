/*
  Warnings:

  - Added the required column `user` to the `GeneratedMessages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."GeneratedMessages" ADD COLUMN     "user" TEXT NOT NULL,
ALTER COLUMN "gender" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."GeneratedMessages" ADD CONSTRAINT "GeneratedMessages_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
