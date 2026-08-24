import { PrismaClient, RoomCategory, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// Same bootstrap pattern master/backend/Code.gs already uses for its own
// Users sheet: one seeded admin account so there's a way to log in at all,
// meant to be used once to add real accounts from the Users tab and then
// left alone (or its password changed).
const BOOTSTRAP_ADMIN_USERNAME = "ggrewal";
const BOOTSTRAP_ADMIN_PASSWORD = "12345678";

const PROPERTY_CODE = process.env.PROPERTY_CODE ?? "SVR-GGN";
const PROPERTY_NAME = process.env.PROPERTY_NAME ?? "StayVista Residences Gurgaon";

/**
 * The 36-room inventory: floors 1-4, rooms 01-09 on each.
 *
 *   x09 on every floor  -> comfort      (109, 209, 309, 409)   =  4
 *   405-408             -> office suite                        =  4
 *   everything else     -> executive                           = 28
 */
const FLOORS = [1, 2, 3, 4];
const ROOMS_PER_FLOOR = 9;
const OFFICE_SUITES = new Set(["405", "406", "407", "408"]);

function categoryFor(roomNumber: string): RoomCategory {
  if (OFFICE_SUITES.has(roomNumber)) return RoomCategory.office_suite;
  if (roomNumber.endsWith("09")) return RoomCategory.comfort;
  return RoomCategory.executive;
}

export function roomInventory(): { roomNumber: string; category: RoomCategory }[] {
  const rooms = [];
  for (const floor of FLOORS) {
    for (let n = 1; n <= ROOMS_PER_FLOOR; n++) {
      const roomNumber = `${floor}${String(n).padStart(2, "0")}`;
      rooms.push({ roomNumber, category: categoryFor(roomNumber) });
    }
  }
  return rooms;
}

async function main() {
  const property = await db.property.upsert({
    where: { code: PROPERTY_CODE },
    update: {},
    create: { code: PROPERTY_CODE, name: PROPERTY_NAME },
  });

  // Upsert rather than create: seeding is safe to re-run, and it must never
  // reset the status of a room that housekeeping or a check-in already owns.
  for (const { roomNumber, category } of roomInventory()) {
    await db.room.upsert({
      where: { propertyId_roomNumber: { propertyId: property.id, roomNumber } },
      update: { category },
      create: { propertyId: property.id, roomNumber, category },
    });
  }

  const counts = await db.room.groupBy({
    by: ["category"],
    where: { propertyId: property.id },
    _count: true,
  });
  console.log(`Seeded ${PROPERTY_NAME} (${PROPERTY_CODE}):`);
  for (const c of counts) console.log(`  ${c.category}: ${c._count}`);

  const existingAdmin = await db.user.findUnique({ where: { username: BOOTSTRAP_ADMIN_USERNAME } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(BOOTSTRAP_ADMIN_PASSWORD, 12);
    await db.user.create({
      data: { username: BOOTSTRAP_ADMIN_USERNAME, passwordHash, role: UserRole.Admin },
    });
    console.log(
      `Seeded bootstrap admin login: ${BOOTSTRAP_ADMIN_USERNAME} / ${BOOTSTRAP_ADMIN_PASSWORD} — ` +
        "log in once and add real accounts from the Users tab.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
