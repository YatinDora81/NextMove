-- CreateTable
CREATE TABLE "public"."AiTemplate" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rules" TEXT[],
    "templateName" TEXT NOT NULL,
    "templateDescription" TEXT,
    "history" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prompt" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "roleNameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiTemplate_userId_idx" ON "public"."AiTemplate"("userId");

-- AddForeignKey
ALTER TABLE "public"."AiTemplate" ADD CONSTRAINT "AiTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
