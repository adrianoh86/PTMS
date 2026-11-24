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
type AntennaInput = { antennaNo: number; side: "A" | "B" };

function parseAntennas(value: unknown): AntennaInput[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32) return null;
  const rows: AntennaInput[] = [];
  const used = new Set<number>();
  for (const item of value) {
    const antennaNo = Number(item?.antennaNo);
    const side = typeof item?.side === "string" ? item.side.toUpperCase() : "";
    if (!Number.isInteger(antennaNo) || antennaNo < 1 || antennaNo > 256 ||
        (side !== "A" && side !== "B") || used.has(antennaNo)) return null;
    used.add(antennaNo);
    rows.push({ antennaNo, side });
  }
  if (!rows.some(x => x.side === "A") || !rows.some(x => x.side === "B")) return null;
  return rows;
}

async function listGates(res: Response) {
  const pool = await getPool();
  const q = await pool.request().query(`
    SELECT g.GateId, g.GateCode, g.GateName, g.ReaderId, r.ReaderCode,
           g.FromZoneId, f.ZoneCode AS FromZoneCode, f.ZoneName AS FromZoneName,
           fs.SiteCode AS FromSiteCode, g.ToZoneId, t.ZoneCode AS ToZoneCode,
           t.ZoneName AS ToZoneName, ts.SiteCode AS ToSiteCode,
           g.IsActive, g.CreatedAt, g.UpdatedAt,
           a.GateAntennaId, a.AntennaNo, a.AntennaSide
    FROM dbo.RfidGate g
    INNER JOIN dbo.RfidReader r ON r.ReaderId=g.ReaderId
    INNER JOIN dbo.Zone f ON f.ZoneId=g.FromZoneId
    INNER JOIN dbo.Site fs ON fs.SiteId=f.SiteId
    INNER JOIN dbo.Zone t ON t.ZoneId=g.ToZoneId
    INNER JOIN dbo.Site ts ON ts.SiteId=t.SiteId
    LEFT JOIN dbo.RfidGateAntenna a ON a.GateId=g.GateId
    ORDER BY g.GateCode, a.AntennaSide, a.AntennaNo
  `);
  const grouped = new Map<string, any>();
  for (const row of q.recordset) {
    const id = String(row.GateId);
    if (!grouped.has(id)) {
      const { GateAntennaId, AntennaNo, AntennaSide, ...gate } = row;
      grouped.set(id, { ...gate, antennas: [] as Array<{ antennaNo: number; side: string; direction: string }> });
    }
    if (row.GateAntennaId != null) {
      grouped.get(id).antennas.push({
        antennaNo: row.AntennaNo,
        side: row.AntennaSide,
        direction: row.AntennaSide === "A" ? "IN (A → B)" : "OUT (B → A)"
      });
    }
  }
  res.json(Array.from(grouped.values()));
}

router.get("/gates", async (_req, res) => {
  try { await listGates(res); }
  catch (err) { console.error("List RFID gates failed", err); res.status(500).json({ message: "Unable to retrieve RFID gates." }); }
});

router.post("/gates", async (req: Request, res: Response) => {
  const gateCode = cleanText(req.body?.gateCode, 50)?.toUpperCase();
  const gateName = cleanText(req.body?.gateName, 150);
  const readerId = validId(req.body?.readerId);
  const fromZoneId = validId(req.body?.fromZoneId);
  const toZoneId = validId(req.body?.toZoneId);
  const antennas = parseAntennas(req.body?.antennas);
  if (!gateCode || !gateName || !readerId || !fromZoneId || !toZoneId ||
      fromZoneId === toZoneId || !antennas) {
    res.status(400).json({ message: "Provide gate code/name, an active reader, two different zones, and unique antenna numbers mapped to both sides A and B." });
    return;
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const check = await tx.request()
      .input("ReaderId", sql.BigInt, readerId)
      .input("FromZoneId", sql.BigInt, fromZoneId)
      .input("ToZoneId", sql.BigInt, toZoneId)
      .query(`SELECT
        (SELECT COUNT(*) FROM dbo.RfidReader WHERE ReaderId=@ReaderId AND IsActive=1) AS ReaderCount,
        (SELECT COUNT(*) FROM dbo.Zone WHERE ZoneId IN(@FromZoneId,@ToZoneId) AND IsActive=1) AS ZoneCount`);
    if (check.recordset[0].ReaderCount !== 1 || check.recordset[0].ZoneCount !== 2) {
      await tx.rollback();
      res.status(400).json({ message: "Reader and both zones must exist and be active." });
      return;
    }
    const inserted = await tx.request()
      .input("GateCode", sql.NVarChar(50), gateCode)
      .input("GateName", sql.NVarChar(150), gateName)
      .input("ReaderId", sql.BigInt, readerId)
      .input("FromZoneId", sql.BigInt, fromZoneId)
      .input("ToZoneId", sql.BigInt, toZoneId)
      .query(`INSERT INTO dbo.RfidGate(GateCode,GateName,ReaderId,FromZoneId,ToZoneId)
              OUTPUT INSERTED.GateId VALUES(@GateCode,@GateName,@ReaderId,@FromZoneId,@ToZoneId)`);
    const gateId = inserted.recordset[0].GateId;
    for (const antenna of antennas) {
      await tx.request().input("GateId", sql.BigInt, gateId)
        .input("AntennaNo", sql.Int, antenna.antennaNo)
        .input("AntennaSide", sql.Char(1), antenna.side)
        .query("INSERT INTO dbo.RfidGateAntenna(GateId,AntennaNo,AntennaSide) VALUES(@GateId,@AntennaNo,@AntennaSide)");
    }
    await tx.commit();
    res.status(201).json({ message: "RFID gate configured.", gateId: String(gateId), gateCode, directionRules: { "A_TO_B": "IN", "B_TO_A": "OUT" }, antennas });
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    if (isDuplicate(err)) { res.status(409).json({ message: "Gate code already exists or this active reader is already assigned to another gate." }); return; }
    console.error("Create RFID gate failed", err);
    res.status(500).json({ message: "Unable to configure RFID gate." });
  }
});

router.put("/gates/:gateId", async (req: Request, res: Response) => {
  const gateId = validId(req.params.gateId);
  const gateCode = cleanText(req.body?.gateCode, 50)?.toUpperCase();
  const gateName = cleanText(req.body?.gateName, 150);
  const readerId = validId(req.body?.readerId);
  const fromZoneId = validId(req.body?.fromZoneId);
  const toZoneId = validId(req.body?.toZoneId);
  const isActive = req.body?.isActive;
  const antennas = parseAntennas(req.body?.antennas);
  if (!gateId || !gateCode || !gateName || !readerId || !fromZoneId || !toZoneId ||
      fromZoneId === toZoneId || typeof isActive !== "boolean" || !antennas) {
    res.status(400).json({ message: "Invalid gate configuration. Map unique antennas to both sides A and B." });
    return;
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const check = await tx.request()
      .input("ReaderId", sql.BigInt, readerId).input("FromZoneId", sql.BigInt, fromZoneId).input("ToZoneId", sql.BigInt, toZoneId)
      .query(`SELECT
        (SELECT COUNT(*) FROM dbo.RfidReader WHERE ReaderId=@ReaderId AND IsActive=1) AS ReaderCount,
        (SELECT COUNT(*) FROM dbo.Zone WHERE ZoneId IN(@FromZoneId,@ToZoneId) AND IsActive=1) AS ZoneCount`);
    if (check.recordset[0].ReaderCount !== 1 || check.recordset[0].ZoneCount !== 2) {
      await tx.rollback(); res.status(400).json({ message: "Reader and both zones must exist and be active." }); return;
    }
    const updated = await tx.request()
      .input("GateId", sql.BigInt, gateId).input("GateCode", sql.NVarChar(50), gateCode)
      .input("GateName", sql.NVarChar(150), gateName).input("ReaderId", sql.BigInt, readerId)
      .input("FromZoneId", sql.BigInt, fromZoneId).input("ToZoneId", sql.BigInt, toZoneId)
      .input("IsActive", sql.Bit, isActive)
      .query(`UPDATE dbo.RfidGate SET GateCode=@GateCode,GateName=@GateName,ReaderId=@ReaderId,
              FromZoneId=@FromZoneId,ToZoneId=@ToZoneId,IsActive=@IsActive,UpdatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.GateId WHERE GateId=@GateId`);
    if (!updated.recordset.length) { await tx.rollback(); res.status(404).json({ message: "RFID gate not found." }); return; }
    await tx.request().input("GateId", sql.BigInt, gateId).query("DELETE FROM dbo.RfidGateAntenna WHERE GateId=@GateId");
    for (const antenna of antennas) {
      await tx.request().input("GateId", sql.BigInt, gateId).input("AntennaNo", sql.Int, antenna.antennaNo)
        .input("AntennaSide", sql.Char(1), antenna.side)
        .query("INSERT INTO dbo.RfidGateAntenna(GateId,AntennaNo,AntennaSide) VALUES(@GateId,@AntennaNo,@AntennaSide)");
    }
    await tx.commit();
    res.json({ message: "RFID gate updated.", gateId: String(gateId), gateCode, isActive, directionRules: { "A_TO_B": "IN", "B_TO_A": "OUT" }, antennas });
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    if (isDuplicate(err)) { res.status(409).json({ message: "Gate code already exists or this active reader is already assigned to another gate." }); return; }
    console.error("Update RFID gate failed", err);
    res.status(500).json({ message: "Unable to update RFID gate." });
  }
});

export default router;
