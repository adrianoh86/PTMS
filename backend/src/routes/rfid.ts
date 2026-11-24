import { Router, Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../config/db";

const router = Router();
const integrationModes = ["VENDOR_SDK", "LLRP", "MQTT", "HTTP"] as const;

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

// Reader inventory and configuration
router.get("/readers", async (_req, res) => {
  try {
    const pool = await getPool();
    const q = await pool.request().query(`
      SELECT r.ReaderId, r.ReaderCode, r.ZoneId, z.ZoneCode, z.ZoneName,
             r.ReaderVendor, r.ReaderModel, r.IntegrationMode, r.ConnectionEndpoint,
             r.SerialNumber, r.IsActive, r.LastHeartbeatAt, r.LastError,
             r.CreatedAt, r.UpdatedAt
      FROM dbo.RfidReader r INNER JOIN dbo.Zone z ON z.ZoneId=r.ZoneId
      ORDER BY r.ReaderCode
    `);
    res.json(q.recordset);
  } catch (err) {
    console.error("List RFID readers failed", err);
    res.status(500).json({ message: "Unable to retrieve RFID readers." });
  }
});

router.post("/readers", async (req: Request, res: Response) => {
  const readerCode = cleanText(req.body?.readerCode, 50)?.toUpperCase();
  const zoneId = validId(req.body?.zoneId);
  const vendor = req.body?.readerVendor == null || req.body.readerVendor === "" ? null : cleanText(req.body.readerVendor, 80);
  const model = req.body?.readerModel == null || req.body.readerModel === "" ? null : cleanText(req.body.readerModel, 100);
  const mode = cleanText(req.body?.integrationMode ?? "HTTP", 20)?.toUpperCase();
  const endpoint = req.body?.connectionEndpoint == null || req.body.connectionEndpoint === "" ? null : cleanText(req.body.connectionEndpoint, 500);
  const serial = req.body?.serialNumber == null || req.body.serialNumber === "" ? null : cleanText(req.body.serialNumber, 100);
  if (!readerCode || !zoneId || (req.body?.readerVendor && !vendor) || (req.body?.readerModel && !model) ||
      !mode || !integrationModes.includes(mode as typeof integrationModes[number]) ||
      (req.body?.connectionEndpoint && !endpoint) || (req.body?.serialNumber && !serial)) {
    res.status(400).json({ message: "Provide a reader code, valid zone, and supported integration mode (VENDOR_SDK, LLRP, MQTT, HTTP)." });
    return;
  }
  try {
    const pool = await getPool();
    const zone = await pool.request().input("ZoneId", sql.BigInt, zoneId)
      .query("SELECT ZoneId FROM dbo.Zone WHERE ZoneId=@ZoneId AND IsActive=1");
    if (!zone.recordset.length) { res.status(400).json({ message: "Selected zone is not active or does not exist." }); return; }
    const q = await pool.request()
      .input("ReaderCode", sql.NVarChar(50), readerCode)
      .input("ZoneId", sql.BigInt, zoneId)
      .input("ReaderVendor", sql.NVarChar(80), vendor)
      .input("ReaderModel", sql.NVarChar(100), model)
      .input("IntegrationMode", sql.VarChar(20), mode)
      .input("ConnectionEndpoint", sql.NVarChar(500), endpoint)
      .input("SerialNumber", sql.NVarChar(100), serial)
      .query(`INSERT INTO dbo.RfidReader (ReaderCode, ZoneId, ReaderVendor, ReaderModel, IntegrationMode, ConnectionEndpoint, SerialNumber)
              OUTPUT INSERTED.ReaderId, INSERTED.ReaderCode, INSERTED.ZoneId, INSERTED.ReaderVendor, INSERTED.ReaderModel,
                     INSERTED.IntegrationMode, INSERTED.ConnectionEndpoint, INSERTED.SerialNumber, INSERTED.IsActive
              VALUES (@ReaderCode,@ZoneId,@ReaderVendor,@ReaderModel,@IntegrationMode,@ConnectionEndpoint,@SerialNumber)`);
    res.status(201).json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "Reader code already exists." }); return; }
    console.error("Create RFID reader failed", err);
    res.status(500).json({ message: "Unable to create RFID reader." });
  }
});

router.put("/readers/:readerId", async (req, res) => {
  const readerId = validId(req.params.readerId);
  const readerCode = cleanText(req.body?.readerCode, 50)?.toUpperCase();
  const zoneId = validId(req.body?.zoneId);
  const mode = cleanText(req.body?.integrationMode, 20)?.toUpperCase();
  const isActive = req.body?.isActive;
  const vendor = req.body?.readerVendor == null || req.body.readerVendor === "" ? null : cleanText(req.body.readerVendor, 80);
  const model = req.body?.readerModel == null || req.body.readerModel === "" ? null : cleanText(req.body.readerModel, 100);
  const endpoint = req.body?.connectionEndpoint == null || req.body.connectionEndpoint === "" ? null : cleanText(req.body.connectionEndpoint, 500);
  const serial = req.body?.serialNumber == null || req.body.serialNumber === "" ? null : cleanText(req.body.serialNumber, 100);
  if (!readerId || !readerCode || !zoneId || !mode || !integrationModes.includes(mode as typeof integrationModes[number]) || typeof isActive !== "boolean") {
    res.status(400).json({ message: "Invalid reader ID or reader configuration." });
    return;
  }
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("ReaderId", sql.BigInt, readerId).input("ReaderCode", sql.NVarChar(50), readerCode)
      .input("ZoneId", sql.BigInt, zoneId).input("ReaderVendor", sql.NVarChar(80), vendor)
      .input("ReaderModel", sql.NVarChar(100), model).input("IntegrationMode", sql.VarChar(20), mode)
      .input("ConnectionEndpoint", sql.NVarChar(500), endpoint).input("SerialNumber", sql.NVarChar(100), serial)
      .input("IsActive", sql.Bit, isActive)
      .query(`UPDATE r SET ReaderCode=@ReaderCode, ZoneId=@ZoneId, ReaderVendor=@ReaderVendor, ReaderModel=@ReaderModel,
                     IntegrationMode=@IntegrationMode, ConnectionEndpoint=@ConnectionEndpoint, SerialNumber=@SerialNumber,
                     IsActive=@IsActive, UpdatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.ReaderId, INSERTED.ReaderCode, INSERTED.ZoneId, INSERTED.ReaderVendor, INSERTED.ReaderModel,
                     INSERTED.IntegrationMode, INSERTED.ConnectionEndpoint, INSERTED.SerialNumber, INSERTED.IsActive
              FROM dbo.RfidReader r INNER JOIN dbo.Zone z ON z.ZoneId=@ZoneId AND z.IsActive=1
              WHERE r.ReaderId=@ReaderId`);
    if (!q.recordset.length) { res.status(404).json({ message: "Reader or active target zone not found." }); return; }
    res.json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "Reader code already exists." }); return; }
    console.error("Update RFID reader failed", err);
    res.status(500).json({ message: "Unable to update RFID reader." });
  }
});

// Normalized ingestion contract for vendor SDK, LLRP, MQTT and HTTP adapters.
// Raw observations are persisted only; this route never changes Pallet.CurrentZoneId.
router.post("/events", async (req, res) => {
  const readerCode = cleanText(req.body?.readerCode, 50)?.toUpperCase();
  const incoming = req.body?.events;
  if (!readerCode || !Array.isArray(incoming) || incoming.length < 1 || incoming.length > 200) {
    res.status(400).json({ message: "Provide readerCode and between 1 and 200 normalized RFID events." });
    return;
  }
  const events = incoming.map((e: any) => ({
    sourceEventKey: e && e.sourceEventKey != null && e.sourceEventKey !== "" ? cleanText(e.sourceEventKey, 160) : null,
    epc: e && cleanText(e.epc, 128)?.toUpperCase(),
    antennaNo: e?.antennaNo == null ? null : Number(e.antennaNo),
    rssi: e?.rssi == null ? null : Number(e.rssi),
    observedAt: e?.observedAt == null ? new Date() : new Date(e.observedAt),
    rawPayload: e?.rawPayload == null ? null : JSON.stringify(e.rawPayload)
  }));
  if (events.some(e => !e.epc || (e.sourceEventKey === null && incoming[events.indexOf(e)]?.sourceEventKey != null && incoming[events.indexOf(e)]?.sourceEventKey !== "") ||
      (e.antennaNo !== null && (!Number.isInteger(e.antennaNo) || e.antennaNo < 1 || e.antennaNo > 256)) ||
      (e.rssi !== null && (!Number.isFinite(e.rssi) || e.rssi < -200 || e.rssi > 100)) ||
      !Number.isFinite(e.observedAt.getTime()) || (e.rawPayload !== null && e.rawPayload.length > 4000))) {
    res.status(400).json({ message: "One or more events contain invalid EPC, source key, antenna, RSSI, timestamp, or raw payload." });
    return;
  }
  const pool = await getPool();
  const readerResult = await pool.request().input("ReaderCode", sql.NVarChar(50), readerCode)
    .query("SELECT ReaderId FROM dbo.RfidReader WHERE ReaderCode=@ReaderCode AND IsActive=1");
  if (!readerResult.recordset.length) { res.status(404).json({ message: "Active RFID reader not found." }); return; }
  const readerId = readerResult.recordset[0].ReaderId;
  const tx = new sql.Transaction(pool);
  const accepted: Array<{ rawEventId: string; epc: string }> = [];
  const duplicates: string[] = [];
  try {
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    for (const event of events) {
      const request = tx.request()
        .input("SourceEventKey", sql.NVarChar(160), event.sourceEventKey)
        .input("Epc", sql.NVarChar(128), event.epc)
        .input("ReaderId", sql.BigInt, readerId)
        .input("AntennaNo", sql.Int, event.antennaNo)
        .input("Rssi", sql.Decimal(8, 3), event.rssi)
        .input("ObservedAt", sql.DateTime2(3), event.observedAt)
        .input("RawPayload", sql.NVarChar(4000), event.rawPayload);
      const q = await request.query(`
        IF @SourceEventKey IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.RfidRawEvent WITH (UPDLOCK,HOLDLOCK) WHERE SourceEventKey=@SourceEventKey)
          SELECT CAST(NULL AS bigint) AS RawEventId, CAST(1 AS bit) AS IsDuplicate;
        ELSE
          INSERT INTO dbo.RfidRawEvent(SourceEventKey,Epc,ReaderId,AntennaNo,Rssi,ObservedAt,RawPayload)
          OUTPUT INSERTED.RawEventId, CAST(0 AS bit) AS IsDuplicate
          VALUES(@SourceEventKey,@Epc,@ReaderId,@AntennaNo,@Rssi,@ObservedAt,@RawPayload);
      `);
      if (q.recordset[0].IsDuplicate) duplicates.push(event.sourceEventKey || "");
      else accepted.push({ rawEventId: String(q.recordset[0].RawEventId), epc: event.epc! });
    }
    await tx.request().input("ReaderId", sql.BigInt, readerId)
      .query("UPDATE dbo.RfidReader SET LastHeartbeatAt=SYSUTCDATETIME(), LastError=NULL, UpdatedAt=SYSUTCDATETIME() WHERE ReaderId=@ReaderId");
    await tx.commit();
    res.status(202).json({ readerCode, received: events.length, accepted: accepted.length, duplicates: duplicates.length, acceptedEvents: accepted, duplicateSourceEventKeys: duplicates, note: "Raw observations stored. No pallet location or confirmed movement was changed." });
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    console.error("Ingest RFID events failed", err);
    res.status(500).json({ message: "Unable to ingest RFID events." });
  }
});

router.get("/events", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const readerCode = req.query.readerCode ? cleanText(req.query.readerCode, 50)?.toUpperCase() : null;
  try {
    const pool = await getPool();
    const q = await pool.request().input("Limit", sql.Int, limit)
      .input("ReaderCode", sql.NVarChar(50), readerCode)
      .query(`SELECT TOP (@Limit) e.RawEventId, e.SourceEventKey, e.Epc, e.ReaderId, r.ReaderCode,
                     e.AntennaNo, e.Rssi, e.ObservedAt, e.ReceivedAt, e.ProcessingStatus
              FROM dbo.RfidRawEvent e LEFT JOIN dbo.RfidReader r ON r.ReaderId=e.ReaderId
              WHERE (@ReaderCode IS NULL OR r.ReaderCode=@ReaderCode)
              ORDER BY e.ReceivedAt DESC`);
    res.json(q.recordset);
  } catch (err) {
    console.error("List RFID raw events failed", err);
    res.status(500).json({ message: "Unable to retrieve RFID raw events." });
  }
});

export default router;
