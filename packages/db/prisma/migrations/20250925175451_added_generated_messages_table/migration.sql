/*
  Warnings:

  - Added the required column `role` to the `Templates` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Templates" ADD COLUMN     "role" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."GeneratedMessages" (
    "id" TEXT NOT NULL,
    "recruiterName" TEXT,
    "role" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "messageType" "public"."MessageType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedMessages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedMessages_id_idx" ON "public"."GeneratedMessages"("id");

-- AddForeignKey
ALTER TABLE "public"."GeneratedMessages" ADD CONSTRAINT "GeneratedMessages_role_fkey" FOREIGN KEY ("role") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneratedMessages" ADD CONSTRAINT "GeneratedMessages_template_fkey" FOREIGN KEY ("template") REFERENCES "public"."Templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GeneratedMessages" ADD CONSTRAINT "GeneratedMessages_company_fkey" FOREIGN KEY ("company") REFERENCES "public"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Templates" ADD CONSTRAINT "Templates_role_fkey" FOREIGN KEY ("role") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
