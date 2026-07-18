import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, savedLocationsTable } from "@workspace/db";

const router: IRouter = Router();

// GET /locations — returns the authenticated user's saved locations only
router.get("/locations", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;
  const locations = await db
    .select()
    .from(savedLocationsTable)
    .where(eq(savedLocationsTable.userId, userId));

  res.json(
    locations.map(l => ({
      id: l.id,
      userId: l.userId,
      label: l.label,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      createdAt: l.createdAt.toISOString(),
    }))
  );
});

// POST /locations — creates a location owned by the authenticated user
router.post("/locations", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;
  const { label, latitude, longitude } = req.body as {
    label?: string; latitude?: number; longitude?: number;
  };

  if (!label?.trim() || latitude == null || longitude == null) {
    res.status(400).json({ error: "الاسم والإحداثيات مطلوبة" });
    return;
  }

  const [location] = await db
    .insert(savedLocationsTable)
    .values({
      userId,
      label: label.trim(),
      latitude: String(latitude),
      longitude: String(longitude),
    })
    .returning();

  res.status(201).json({
    id: location.id,
    userId: location.userId,
    label: location.label,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    createdAt: location.createdAt.toISOString(),
  });
});

// DELETE /locations/:locationId — only the owner can delete their location
router.delete("/locations/:locationId", async (req, res): Promise<void> => {
  const { locationId } = req.params;
  const userId = req.auth!.userId;

  const deleted = await db
    .delete(savedLocationsTable)
    .where(and(
      eq(savedLocationsTable.id, locationId),
      eq(savedLocationsTable.userId, userId),
    ))
    .returning({ id: savedLocationsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "الموقع غير موجود أو لا تملك صلاحية حذفه" });
    return;
  }

  res.json({ success: true });
});

export default router;
