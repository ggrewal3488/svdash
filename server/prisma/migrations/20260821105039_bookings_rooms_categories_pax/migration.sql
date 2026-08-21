-- CreateEnum
CREATE TYPE "RoomCategory" AS ENUM ('comfort', 'executive', 'office_suite');

-- AlterEnum
BEGIN;
CREATE TYPE "RoomStatus_new" AS ENUM ('vacant_ready', 'vacant_dirty', 'occupied', 'maintenance', 'out_of_order');
ALTER TABLE "Room" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Room" ALTER COLUMN "status" TYPE "RoomStatus_new" USING ("status"::text::"RoomStatus_new");
ALTER TYPE "RoomStatus" RENAME TO "RoomStatus_old";
ALTER TYPE "RoomStatus_new" RENAME TO "RoomStatus";
DROP TYPE "RoomStatus_old";
ALTER TABLE "Room" ALTER COLUMN "status" SET DEFAULT 'vacant_ready';
COMMIT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "pax" INTEGER,
ADD COLUMN     "sourcePrimary" TEXT,
ADD COLUMN     "sourceSecondary" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "category" "RoomCategory" NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'vacant_ready';

