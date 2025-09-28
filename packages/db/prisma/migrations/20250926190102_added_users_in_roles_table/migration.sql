-- CreateTable
CREATE TABLE "public"."_User_Roles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_User_Roles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_User_Roles_B_index" ON "public"."_User_Roles"("B");

-- AddForeignKey
ALTER TABLE "public"."_User_Roles" ADD CONSTRAINT "_User_Roles_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_User_Roles" ADD CONSTRAINT "_User_Roles_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
