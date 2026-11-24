import { Router, Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../config/db";

const router = Router();

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 && v.length <= max ? v : null;
}

function validId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function isDuplicate(error: unknown): boolean {
  const e = error as { number?: number };
  return e?.number === 2601 || e?.number === 2627;
}

// Confirm a manually verified pallet movement.
// Raw RFID observations are deliberately not accepted by this endpoint.
router.post("/confirm", async (req: Request, res: Response) => {
  const palletId = validId(req.body?.palletId);
  const toZoneId = validId(req.body?.toZoneId);
  const movementEventKey = cleanText(req.body?.movementEventKey, 160);
  const confirmedBy = cleanText(req.body?.confirmedBy, 80);

  if (!palletId || !toZoneId || !movementEventKey || !confirmedBy) {
    res.status(400).json({
      message: "Provide palletId, toZoneId, movementEventKey and confirmedBy."
    });
    return;
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const prior = await tx.request()
      .input("MovementEventKey", sql.NVarChar(160), movementEventKey)
      .query("SELECT MovementId FROM dbo.PalletMovement WHERE MovementEventKey=@MovementEventKey");

    if (prior.recordset.length) {
      await tx.rollback();
      res.status(409).json({ message: "This movement event key has already been used.", movementId: String(prior.recordset[0].MovementId) });
      return;
    }

    const palletResult = await tx.request()
      .input("PalletId", sql.BigInt, palletId)
      .query(`SELECT PalletId, PalletCode, Status, CurrentZoneId
              FROM dbo.Pallet WITH (UPDLOCK, HOLDLOCK)
              WHERE PalletId=@PalletId`);

    if (!palletResult.recordset.length) {
      await tx.rollback();
      res.status(404).json({ message: "Pallet not found." });
      return;
    }

    const pallet = palletResult.recordset[0];
    if (pallet.Status !== "ACTIVE") {
      await tx.rollback();
      res.status(409).json({ message: "Only ACTIVE pallets can be moved. Resolve the pallet status first." });
      return;
    }

    const zoneResult = await tx.request()
      .input("ZoneId", sql.BigInt, toZoneId)
      .query(`SELECT z.ZoneId, z.ZoneCode, z.ZoneName, s.SiteCode, s.SiteName
              FROM dbo.Zone z INNER JOIN dbo.Site s ON s.SiteId=z.SiteId
              WHERE z.ZoneId=@ZoneId AND z.IsActive=1 AND s.IsActive=1`);

    if (!zoneResult.recordset.length) {
      await tx.rollback();
      res.status(400).json({ message: "Destination zone does not exist or is inactive." });
      return;
    }

    if (pallet.CurrentZoneId !== null && Number(pallet.CurrentZoneId) === toZoneId) {
      await tx.rollback();
      res.status(409).json({ message: "Pallet is already recorded in the destination zone." });
      return;
    }

    const fromZoneId = pallet.CurrentZoneId == null ? null : Number(pallet.CurrentZoneId);
    const confirmedAt = new Date();

    const inserted = await tx.request()
      .input("MovementEventKey", sql.NVarChar(160), movementEventKey)
      .input("PalletId", sql.BigInt, palletId)
      .input("FromZoneId", sql.BigInt, fromZoneId)
      .input("ToZoneId", sql.BigInt, toZoneId)
      .input("ConfirmedAt", sql.DateTime2(3), confirmedAt)
      .input("ConfirmedBy", sql.NVarChar(80), confirmedBy)
      .query(`INSERT INTO dbo.PalletMovement
                (MovementEventKey, PalletId, FromZoneId, ToZoneId, MovementType, DetectionMethod, ConfirmedAt, ConfirmedBy)
              OUTPUT INSERTED.MovementId, INSERTED.MovementEventKey, INSERTED.PalletId,
                     INSERTED.FromZoneId, INSERTED.ToZoneId, INSERTED.MovementType,
                     INSERTED.DetectionMethod, INSERTED.ConfirmedAt, INSERTED.ConfirmedBy
              VALUES
                (@MovementEventKey, @PalletId, @FromZoneId, @ToZoneId, 'ZONE_TRANSFER', 'MANUAL', @ConfirmedAt, @ConfirmedBy)`);

    await tx.request()
      .input("PalletId", sql.BigInt, palletId)
      .input("ToZoneId", sql.BigInt, toZoneId)
      .input("ConfirmedAt", sql.DateTime2(3), confirmedAt)
      .query(`UPDATE dbo.Pallet
              SET CurrentZoneId=@ToZoneId, LastConfirmedAt=@ConfirmedAt, UpdatedAt=SYSUTCDATETIME()
              WHERE PalletId=@PalletId`);

    await tx.commit();
    res.status(201).json({
      message: "Manual pallet movement confirmed.",
      palletCode: pallet.PalletCode,
      fromZoneId,
      destination: zoneResult.recordset[0],
      movement: inserted.recordset[0]
    });
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    if (isDuplicate(err)) {
      res.status(409).json({ message: "Movement event key already exists." });
      return;
    }
    console.error("Confirm pallet movement failed", err);
    res.status(500).json({ message: "Unable to confirm pallet movement." });
  }
});

// Confirmed movement history for one pallet.
router.get("/pallets/:palletId/history", async (req, res) => {
  const palletId = validId(req.params.palletId);
  if (!palletId) {
    res.status(400).json({ message: "Invalid pallet ID." });
    return;
  }

  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("PalletId", sql.BigInt, palletId)
      .query(`SELECT m.MovementId, m.MovementEventKey, m.PalletId, p.PalletCode,
                     m.FromZoneId, f.ZoneCode AS FromZoneCode, f.ZoneName AS FromZoneName,
                     m.ToZoneId, t.ZoneCode AS ToZoneCode, t.ZoneName AS ToZoneName,
                     m.MovementType, m.DetectionMethod, m.ConfirmedAt, m.ConfirmedBy
              FROM dbo.PalletMovement m
              INNER JOIN dbo.Pallet p ON p.PalletId=m.PalletId
              LEFT JOIN dbo.Zone f ON f.ZoneId=m.FromZoneId
              INNER JOIN dbo.Zone t ON t.ZoneId=m.ToZoneId
              WHERE m.PalletId=@PalletId
              ORDER BY m.ConfirmedAt DESC, m.MovementId DESC`);

    res.json(q.recordset);
  } catch (err) {
    console.error("Read pallet movement history failed", err);
    res.status(500).json({ message: "Unable to retrieve pallet movement history." });
  }
});

export default router;
