-- CreateEnum
CREATE TYPE "public"."AiKeyStatus" AS ENUM ('ACTIVE', 'COOLDOWN', 'EXHAUSTED', 'DEAD');

-- CreateTable
CREATE TABLE "public"."UserGeminiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "last4" TEXT NOT NULL,
    "status" "public"."AiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGeminiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserGeminiKey_userId_status_idx" ON "public"."UserGeminiKey"("userId", "status");

-- AddForeignKey
ALTER TABLE "public"."UserGeminiKey" ADD CONSTRAINT "UserGeminiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
