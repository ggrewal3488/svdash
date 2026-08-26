-- Replace the generic Admin/User roles with the real front-desk role
-- categories: Admin, FrontDesk, Housekeeping, BOH. Postgres can't drop a
-- single enum value in place, so this recreates the type; safe here since
-- the only role in use is 'Admin', which exists in both old and new sets.
CREATE TYPE "UserRole_new" AS ENUM ('Admin', 'FrontDesk', 'Housekeeping', 'BOH');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'FrontDesk';

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
