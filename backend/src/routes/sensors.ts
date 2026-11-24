import { Router } from "express";
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

type SensorInput = { sensorCode: string; sensorName: string; sensorSide: "A" | "B" };

function parseSensors(value: unknown): SensorInput[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const sensors: SensorInput[] = [];
  const sides = new Set<string>();
  const codes = new Set<string>();
  for (const item of value) {
    const sensorCode = cleanText(item?.sensorCode, 80)?.toUpperCase();
    const sensorName = cleanText(item?.sensorName, 120);
    const sensorSide = typeof item?.sensorSide === "string" ? item.sensorSide.toUpperCase() : "";
    if (!sensorCode || !sensorName || (sensorSide !== "A" && sensorSide !== "B") ||
        sides.has(sensorSide) || codes.has(sensorCode)) return null;
    sides.add(sensorSide);
    codes.add(sensorCode);
    sensors.push({ sensorCode, sensorName, sensorSide });
  }
  return sides.has("A") && sides.has("B") ? sensors : null;
}

// Configure the two photoelectric sensors together so a gate cannot be left
// with an incomplete A/B pair. Existing sensor IDs are retained by side.
router.get("/gates/:gateId/sensors", async (req, res) => {
  const gateId = validId(req.params.gateId);
  if (!gateId) { res.status(400).json({ message: "Invalid gate ID." }); return; }
  try {
    const pool = await getPool();
    const q = await pool.request().input("GateId", sql.BigInt, gateId).query(`
      SELECT s.SensorId, s.GateId, g.GateCode, s.SensorCode, s.SensorName,
             s.SensorSide, s.SensorType, s.IsActive, s.CreatedAt, s.UpdatedAt
      FROM dbo.RfidGateSensor s
      INNER JOIN dbo.RfidGate g ON g.GateId=s.GateId
      WHERE s.GateId=@GateId
      ORDER BY s.SensorSide
    `);
    res.json(q.recordset);
  } catch (err) {
    console.error("List gate sensors failed", err);
    res.status(500).json({ message: "Unable to retrieve gate sensors." });
  }
});

router.post("/gates/:gateId/sensors", async (req, res) => {
  const gateId = validId(req.params.gateId);
  const sensors = parseSensors(req.body?.sensors);
  if (!gateId || !sensors) {
    res.status(400).json({ message: "Provide exactly two sensors: one sensorSide A and one sensorSide B, each with a unique sensorCode and sensorName." });
    return;
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const gate = await tx.request().input("GateId", sql.BigInt, gateId)
      .query("SELECT GateId FROM dbo.RfidGate WITH (UPDLOCK,HOLDLOCK) WHERE GateId=@GateId");
    if (!gate.recordset.length) {
      await tx.rollback();
      res.status(404).json({ message: "RFID gate not found." });
      return;
    }
    for (const sensor of sensors) {
      await tx.request()
        .input("GateId", sql.BigInt, gateId)
        .input("SensorCode", sql.NVarChar(80), sensor.sensorCode)
        .input("SensorName", sql.NVarChar(120), sensor.sensorName)
        .input("SensorSide", sql.Char(1), sensor.sensorSide)
        .query(`
          IF EXISTS (SELECT 1 FROM dbo.RfidGateSensor WITH (UPDLOCK,HOLDLOCK) WHERE GateId=@GateId AND SensorSide=@SensorSide)
            UPDATE dbo.RfidGateSensor
            SET SensorCode=@SensorCode, SensorName=@SensorName, SensorType='PHOTOELECTRIC',
                IsActive=1, UpdatedAt=SYSUTCDATETIME()
            WHERE GateId=@GateId AND SensorSide=@SensorSide;
          ELSE
            INSERT INTO dbo.RfidGateSensor(GateId,SensorCode,SensorName,SensorSide)
            VALUES(@GateId,@SensorCode,@SensorName,@SensorSide);
        `);
    }
    const result = await tx.request().input("GateId", sql.BigInt, gateId).query(`
      SELECT SensorId, GateId, SensorCode, SensorName, SensorSide, SensorType, IsActive
      FROM dbo.RfidGateSensor WHERE GateId=@GateId ORDER BY SensorSide
    `);
    await tx.commit();
    res.status(200).json({ message: "Gate photoelectric sensors configured.", gateId: String(gateId), sensors: result.recordset });
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    if (isDuplicate(err)) { res.status(409).json({ message: "A sensor code is already assigned to another gate or side." }); return; }
    console.error("Configure gate sensors failed", err);
    res.status(500).json({ message: "Unable to configure gate sensors." });
  }
});

// PLC HTTP event contract. Events are stored as observations only; they do not
// infer passage direction or change pallet location.
router.post("/sensor-events", async (req, res) => {
  const gateCode = cleanText(req.body?.gateCode, 50)?.toUpperCase();
  const sensorCode = cleanText(req.body?.sensorCode, 80)?.toUpperCase();
  const state = cleanText(req.body?.state, 10)?.toUpperCase();
  const sourceEventKey = cleanText(req.body?.sourceEventKey, 120);
  const observedAt = req.body?.observedAt == null ? new Date() : new Date(req.body.observedAt);
  const rawPayload = req.body?.rawPayload == null ? JSON.stringify(req.body) : JSON.stringify(req.body.rawPayload);

  if (!gateCode || !sensorCode || !sourceEventKey || (state !== "BLOCKED" && state !== "CLEAR") ||
      !Number.isFinite(observedAt.getTime()) || rawPayload.length > 4000) {
    res.status(400).json({ message: "Provide gateCode, sensorCode, state (BLOCKED or CLEAR), sourceEventKey, a valid observedAt timestamp, and a raw payload no larger than 4000 characters." });
    return;
  }
  try {
    const pool = await getPool();
    const sensorResult = await pool.request()
      .input("GateCode", sql.NVarChar(50), gateCode)
      .input("SensorCode", sql.NVarChar(80), sensorCode)
      .query(`
        SELECT s.SensorId, s.SensorCode, s.SensorSide, g.GateCode
        FROM dbo.RfidGateSensor s
        INNER JOIN dbo.RfidGate g ON g.GateId=s.GateId
        WHERE g.GateCode=@GateCode AND s.SensorCode=@SensorCode
          AND g.IsActive=1 AND s.IsActive=1
      `);
    if (!sensorResult.recordset.length) {
      res.status(404).json({ message: "Active sensor was not found under the specified gate." });
      return;
    }
    const sensor = sensorResult.recordset[0];
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const existing = await tx.request().input("SourceEventKey", sql.NVarChar(120), sourceEventKey)
        .query("SELECT SensorEventId FROM dbo.RfidGateSensorEvent WITH (UPDLOCK,HOLDLOCK) WHERE SourceEventKey=@SourceEventKey");
      if (existing.recordset.length) {
        await tx.commit();
        res.status(200).json({ accepted: false, duplicate: true, sourceEventKey, note: "Duplicate sensor event ignored." });
        return;
      }
      const inserted = await tx.request()
        .input("SourceEventKey", sql.NVarChar(120), sourceEventKey)
        .input("SensorId", sql.Int, sensor.SensorId)
        .input("SensorState", sql.VarChar(10), state)
        .input("ObservedAt", sql.DateTime2(3), observedAt)
        .input("RawPayload", sql.NVarChar(4000), rawPayload)
        .query(`
          INSERT INTO dbo.RfidGateSensorEvent(SourceEventKey,SensorId,SensorState,ObservedAt,RawPayload)
          OUTPUT INSERTED.SensorEventId, INSERTED.ReceivedAt, INSERTED.ProcessingStatus
          VALUES(@SourceEventKey,@SensorId,@SensorState,@ObservedAt,@RawPayload)
        `);
      await tx.commit();
      res.status(202).json({
        accepted: true,
        duplicate: false,
        sensorEventId: String(inserted.recordset[0].SensorEventId),
        gateCode,
        sensorCode: sensor.SensorCode,
        sensorSide: sensor.SensorSide,
        state,
        receivedAt: inserted.recordset[0].ReceivedAt,
        processingStatus: inserted.recordset[0].ProcessingStatus,
        note: "Sensor observation stored only. No direction, passage, or pallet location was changed."
      });
    } catch (err) {
      try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
      if (isDuplicate(err)) {
        res.status(200).json({ accepted: false, duplicate: true, sourceEventKey, note: "Duplicate sensor event ignored." });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error("Ingest gate sensor event failed", err);
    res.status(500).json({ message: "Unable to ingest gate sensor event." });
  }
});

router.get("/sensor-events", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const gateCode = req.query.gateCode ? cleanText(req.query.gateCode, 50)?.toUpperCase() : null;
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("Limit", sql.Int, limit)
      .input("GateCode", sql.NVarChar(50), gateCode)
      .query(`
        SELECT TOP (@Limit) e.SensorEventId, e.SourceEventKey, g.GateCode,
               s.SensorCode, s.SensorSide, e.SensorState, e.ObservedAt,
               e.ReceivedAt, e.ProcessingStatus
        FROM dbo.RfidGateSensorEvent e
        INNER JOIN dbo.RfidGateSensor s ON s.SensorId=e.SensorId
        INNER JOIN dbo.RfidGate g ON g.GateId=s.GateId
        WHERE (@GateCode IS NULL OR g.GateCode=@GateCode)
        ORDER BY e.ReceivedAt DESC
      `);
    res.json(q.recordset);
  } catch (err) {
    console.error("List gate sensor events failed", err);
    res.status(500).json({ message: "Unable to retrieve gate sensor events." });
  }
});

export default router;
