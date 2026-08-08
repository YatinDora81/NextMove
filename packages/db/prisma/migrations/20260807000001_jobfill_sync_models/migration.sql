-- CreateEnum
CREATE TYPE "public"."JobAppStatus" AS ENUM ('DRAFT', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'GHOSTED');

-- CreateTable
CREATE TABLE "public"."ProfileBlob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "url" TEXT,
    "ats" TEXT,
    "status" "public"."JobAppStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3),
    "notes" TEXT,
    "fillStats" JSONB,
    "history" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SiteMapping" (
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sigHash" TEXT NOT NULL,
    "profilePath" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteMapping_pkey" PRIMARY KEY ("userId","domain","sigHash")
);

-- CreateTable
CREATE TABLE "public"."Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBlob_userId_key" ON "public"."ProfileBlob"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_clientId_key" ON "public"."JobApplication"("clientId");

-- CreateIndex
CREATE INDEX "JobApplication_userId_status_appliedAt_idx" ON "public"."JobApplication"("userId", "status", "appliedAt");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "public"."Device"("userId");

-- AddForeignKey
ALTER TABLE "public"."ProfileBlob" ADD CONSTRAINT "ProfileBlob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SiteMapping" ADD CONSTRAINT "SiteMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
