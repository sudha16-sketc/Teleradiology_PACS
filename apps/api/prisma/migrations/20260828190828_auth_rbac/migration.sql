-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- AlterTable
-- passwordHash uses a temporary default so pre-existing rows satisfy NOT NULL;
-- the default is dropped afterwards. Existing rows receive a placeholder hash.
ALTER TABLE "User" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "organization" TEXT,
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT 'placeholder-not-usable',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestedRole" "UserRole",
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP DEFAULT;

-- Mark pre-existing seed users as approved so they remain usable, and
-- backfill their role into requestedRole for consistency.
UPDATE "User" SET "status" = 'APPROVED', "isActive" = true;

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;