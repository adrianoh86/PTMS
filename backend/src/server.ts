import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import sql from "mssql";
import { getPool } from "./config/db";
import rfidRouter from "./routes/rfid";
import movementsRouter from "./routes/movements";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/rfid", rfidRouter);
app.use("/api/movements", movementsRouter);

const siteTypes = ["FACTORY", "EXTERNAL_WAREHOUSE"] as const;
const zoneTypes = ["RECEIVING", "STORAGE", "STAGING", "PRODUCTION", "DISPATCH", "OTHER"] as const;

function textField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= max ? cleaned : null;
}
function isDuplicate(error: unknown): boolean {
  const e = error as { number?: number };
  return e?.number === 2601 || e?.number === 2627;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "ptms-api", version: "0.4.0" }));

app.get("/api/db/health", async (_req, res) => {
  try {
    const pool = await getPool();
    const q = await pool.request().query("SELECT DB_NAME() AS databaseName, SYSDATETIMEOFFSET() AS serverTime");
    res.json({ status: "connected", ...q.recordset[0] });
  } catch (err) {
    console.error("DB health check failed", err);
    res.status(503).json({ status: "unavailable", message: "Database connection failed. Check configuration and network access." });
  }
});

// Site master
app.get("/api/sites", async (_req, res) => {
  try {
    const pool = await getPool();
    const q = await pool.request().query(`
      SELECT s.SiteId, s.SiteCode, s.SiteName, s.SiteType, s.IsActive,
             COUNT(z.ZoneId) AS ZoneCount
      FROM dbo.Site s
      LEFT JOIN dbo.Zone z ON z.SiteId = s.SiteId AND z.IsActive = 1
      GROUP BY s.SiteId, s.SiteCode, s.SiteName, s.SiteType, s.IsActive
      ORDER BY s.SiteName
    `);
    res.json(q.recordset);
  } catch (err) {
    console.error("List sites failed", err);
    res.status(500).json({ message: "Unable to retrieve sites." });
  }
});

app.post("/api/sites", async (req: Request, res: Response) => {
  const siteCode = textField(req.body?.siteCode, 30)?.toUpperCase();
  const siteName = textField(req.body?.siteName, 150);
  const siteType = textField(req.body?.siteType, 30)?.toUpperCase();
  if (!siteCode || !siteName || !siteType || !siteTypes.includes(siteType as typeof siteTypes[number])) {
    res.status(400).json({ message: "Provide a site code (max 30), site name (max 150), and valid site type." });
    return;
  }
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("SiteCode", sql.NVarChar(30), siteCode)
      .input("SiteName", sql.NVarChar(150), siteName)
      .input("SiteType", sql.VarChar(30), siteType)
      .query(`INSERT INTO dbo.Site (SiteCode, SiteName, SiteType)
              OUTPUT INSERTED.SiteId, INSERTED.SiteCode, INSERTED.SiteName, INSERTED.SiteType, INSERTED.IsActive
              VALUES (@SiteCode, @SiteName, @SiteType)`);
    res.status(201).json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "A site with this code already exists." }); return; }
    console.error("Create site failed", err);
    res.status(500).json({ message: "Unable to create site." });
  }
});

app.put("/api/sites/:siteId", async (req: Request, res: Response) => {
  const siteId = Number(req.params.siteId);
  const siteCode = textField(req.body?.siteCode, 30)?.toUpperCase();
  const siteName = textField(req.body?.siteName, 150);
  const siteType = textField(req.body?.siteType, 30)?.toUpperCase();
  const isActive = req.body?.isActive;
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !siteCode || !siteName ||
      !siteType || !siteTypes.includes(siteType as typeof siteTypes[number]) || typeof isActive !== "boolean") {
    res.status(400).json({ message: "Invalid site ID or site details." });
    return;
  }
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("SiteId", sql.Int, siteId)
      .input("SiteCode", sql.NVarChar(30), siteCode)
      .input("SiteName", sql.NVarChar(150), siteName)
      .input("SiteType", sql.VarChar(30), siteType)
      .input("IsActive", sql.Bit, isActive)
      .query(`UPDATE dbo.Site SET SiteCode=@SiteCode, SiteName=@SiteName, SiteType=@SiteType, IsActive=@IsActive
              OUTPUT INSERTED.SiteId, INSERTED.SiteCode, INSERTED.SiteName, INSERTED.SiteType, INSERTED.IsActive
              WHERE SiteId=@SiteId`);
    if (!q.recordset.length) { res.status(404).json({ message: "Site not found." }); return; }
    res.json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "A site with this code already exists." }); return; }
    console.error("Update site failed", err);
    res.status(500).json({ message: "Unable to update site." });
  }
});

// Zones are scoped to a site. Inactive sites cannot receive new zones.
app.get("/api/sites/:siteId/zones", async (req, res) => {
  const siteId = Number(req.params.siteId);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) { res.status(400).json({ message: "Invalid site ID." }); return; }
  try {
    const pool = await getPool();
    const q = await pool.request().input("SiteId", sql.Int, siteId).query(
      "SELECT ZoneId, SiteId, ZoneCode, ZoneName, ZoneType, IsActive FROM dbo.Zone WHERE SiteId=@SiteId ORDER BY ZoneName"
    );
    res.json(q.recordset);
  } catch (err) {
    console.error("List zones failed", err);
    res.status(500).json({ message: "Unable to retrieve zones." });
  }
});

app.post("/api/sites/:siteId/zones", async (req, res) => {
  const siteId = Number(req.params.siteId);
  const zoneCode = textField(req.body?.zoneCode, 40)?.toUpperCase();
  const zoneName = textField(req.body?.zoneName, 150);
  const zoneType = textField(req.body?.zoneType, 30)?.toUpperCase();
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !zoneCode || !zoneName ||
      !zoneType || !zoneTypes.includes(zoneType as typeof zoneTypes[number])) {
    res.status(400).json({ message: "Provide a valid site ID, zone code, zone name, and zone type." });
    return;
  }
  try {
    const pool = await getPool();
    const site = await pool.request().input("SiteId", sql.Int, siteId)
      .query("SELECT SiteId FROM dbo.Site WHERE SiteId=@SiteId AND IsActive=1");
    if (!site.recordset.length) { res.status(404).json({ message: "Active site not found." }); return; }
    const q = await pool.request()
      .input("SiteId", sql.Int, siteId)
      .input("ZoneCode", sql.NVarChar(40), zoneCode)
      .input("ZoneName", sql.NVarChar(150), zoneName)
      .input("ZoneType", sql.VarChar(30), zoneType)
      .query(`INSERT INTO dbo.Zone (SiteId, ZoneCode, ZoneName, ZoneType)
              OUTPUT INSERTED.ZoneId, INSERTED.SiteId, INSERTED.ZoneCode, INSERTED.ZoneName, INSERTED.ZoneType, INSERTED.IsActive
              VALUES (@SiteId, @ZoneCode, @ZoneName, @ZoneType)`);
    res.status(201).json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "This zone code already exists at the selected site." }); return; }
    console.error("Create zone failed", err);
    res.status(500).json({ message: "Unable to create zone." });
  }
});

app.put("/api/zones/:zoneId", async (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const zoneCode = textField(req.body?.zoneCode, 40)?.toUpperCase();
  const zoneName = textField(req.body?.zoneName, 150);
  const zoneType = textField(req.body?.zoneType, 30)?.toUpperCase();
  const isActive = req.body?.isActive;
  if (!Number.isSafeInteger(zoneId) || zoneId <= 0 || !zoneCode || !zoneName ||
      !zoneType || !zoneTypes.includes(zoneType as typeof zoneTypes[number]) || typeof isActive !== "boolean") {
    res.status(400).json({ message: "Invalid zone ID or zone details." });
    return;
  }
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("ZoneId", sql.BigInt, zoneId)
      .input("ZoneCode", sql.NVarChar(40), zoneCode)
      .input("ZoneName", sql.NVarChar(150), zoneName)
      .input("ZoneType", sql.VarChar(30), zoneType)
      .input("IsActive", sql.Bit, isActive)
      .query(`UPDATE dbo.Zone SET ZoneCode=@ZoneCode, ZoneName=@ZoneName, ZoneType=@ZoneType, IsActive=@IsActive
              OUTPUT INSERTED.ZoneId, INSERTED.SiteId, INSERTED.ZoneCode, INSERTED.ZoneName, INSERTED.ZoneType, INSERTED.IsActive
              WHERE ZoneId=@ZoneId`);
    if (!q.recordset.length) { res.status(404).json({ message: "Zone not found." }); return; }
    res.json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "This zone code already exists at the selected site." }); return; }
    console.error("Update zone failed", err);
    res.status(500).json({ message: "Unable to update zone." });
  }
});


// Pallet registration and master data
app.get("/api/pallets", async (_req, res) => {
  try {
    const pool = await getPool();
    const q = await pool.request().query(`
      SELECT p.PalletId, p.PalletCode, p.PalletType, p.Status, p.CurrentZoneId,
             z.ZoneCode, z.ZoneName, s.SiteCode, s.SiteName,
             ep.Epc AS ActiveEpc,
             (SELECT COUNT(*) FROM dbo.PalletContent pc WHERE pc.PalletId=p.PalletId AND pc.IsActive=1) AS ActiveMaterialLines
      FROM dbo.Pallet p
      LEFT JOIN dbo.Zone z ON z.ZoneId=p.CurrentZoneId
      LEFT JOIN dbo.Site s ON s.SiteId=z.SiteId
      LEFT JOIN dbo.PalletEpc ep ON ep.PalletId=p.PalletId AND ep.IsActive=1
      ORDER BY p.PalletCode
    `);
    res.json(q.recordset);
  } catch (err) {
    console.error("List pallets failed", err);
    res.status(500).json({ message: "Unable to retrieve pallets." });
  }
});

app.post("/api/pallets", async (req, res) => {
  const palletCode = textField(req.body?.palletCode, 50)?.toUpperCase();
  const palletType = textField(req.body?.palletType, 40);
  const zoneId = req.body?.currentZoneId == null || req.body.currentZoneId === "" ? null : Number(req.body.currentZoneId);
  if (!palletCode || !palletType || (zoneId !== null && (!Number.isSafeInteger(zoneId) || zoneId <= 0))) {
    res.status(400).json({ message: "Provide a pallet code (max 50), pallet type (max 40), and valid optional zone." });
    return;
  }
  try {
    const pool = await getPool();
    if (zoneId !== null) {
      const zone = await pool.request().input("ZoneId", sql.BigInt, zoneId)
        .query("SELECT z.ZoneId FROM dbo.Zone z INNER JOIN dbo.Site s ON s.SiteId=z.SiteId WHERE z.ZoneId=@ZoneId AND z.IsActive=1 AND s.IsActive=1");
      if (!zone.recordset.length) { res.status(400).json({ message: "Selected zone is not active or does not exist." }); return; }
    }
    const q = await pool.request()
      .input("PalletCode", sql.NVarChar(50), palletCode)
      .input("PalletType", sql.NVarChar(40), palletType)
      .input("CurrentZoneId", sql.BigInt, zoneId)
      .query(`INSERT INTO dbo.Pallet (PalletCode, PalletType, CurrentZoneId)
              OUTPUT INSERTED.PalletId, INSERTED.PalletCode, INSERTED.PalletType, INSERTED.Status, INSERTED.CurrentZoneId
              VALUES (@PalletCode, @PalletType, @CurrentZoneId)`);
    res.status(201).json(q.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) { res.status(409).json({ message: "A pallet with this code already exists." }); return; }
    console.error("Create pallet failed", err);
    res.status(500).json({ message: "Unable to register pallet." });
  }
});

app.get("/api/pallets/:palletId/epc", async (req, res) => {
  const palletId = Number(req.params.palletId);
  if (!Number.isSafeInteger(palletId) || palletId <= 0) { res.status(400).json({ message: "Invalid pallet ID." }); return; }
  try {
    const pool = await getPool();
    const q = await pool.request().input("PalletId", sql.BigInt, palletId).query(
      "SELECT PalletEpcId, PalletId, Epc, IsActive, AssignedAt, DeactivatedAt FROM dbo.PalletEpc WHERE PalletId=@PalletId ORDER BY AssignedAt DESC"
    );
    res.json(q.recordset);
  } catch (err) {
    console.error("Read EPC history failed", err);
    res.status(500).json({ message: "Unable to retrieve EPC history." });
  }
});

app.post("/api/pallets/:palletId/epc", async (req, res) => {
  const palletId = Number(req.params.palletId);
  const epc = textField(req.body?.epc, 128)?.toUpperCase();
  if (!Number.isSafeInteger(palletId) || palletId <= 0 || !epc) {
    res.status(400).json({ message: "Provide a valid pallet ID and EPC (max 128 characters)." });
    return;
  }
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const pallet = await tx.request().input("PalletId", sql.BigInt, palletId)
      .query("SELECT PalletId FROM dbo.Pallet WITH (UPDLOCK, HOLDLOCK) WHERE PalletId=@PalletId");
    if (!pallet.recordset.length) {
      await tx.rollback();
      res.status(404).json({ message: "Pallet not found." });
      return;
    }
    const existing = await tx.request().input("Epc", sql.NVarChar(128), epc)
      .query("SELECT PalletId FROM dbo.PalletEpc WITH (UPDLOCK, HOLDLOCK) WHERE Epc=@Epc AND IsActive=1");
    if (existing.recordset.length && Number(existing.recordset[0].PalletId) !== palletId) {
      await tx.rollback();
      res.status(409).json({ message: "This EPC is already actively assigned to another pallet." });
      return;
    }
    await tx.request().input("PalletId", sql.BigInt, palletId)
      .query("UPDATE dbo.PalletEpc SET IsActive=0, DeactivatedAt=SYSUTCDATETIME() WHERE PalletId=@PalletId AND IsActive=1");
    const inserted = await tx.request()
      .input("PalletId", sql.BigInt, palletId)
      .input("Epc", sql.NVarChar(128), epc)
      .query(`INSERT INTO dbo.PalletEpc (PalletId, Epc)
              OUTPUT INSERTED.PalletEpcId, INSERTED.PalletId, INSERTED.Epc, INSERTED.IsActive, INSERTED.AssignedAt
              VALUES (@PalletId, @Epc)`);
    await tx.commit();
    res.status(201).json(inserted.recordset[0]);
  } catch (err) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    if (isDuplicate(err)) { res.status(409).json({ message: "EPC assignment conflicts with an existing active assignment." }); return; }
    console.error("Assign EPC failed", err);
    res.status(500).json({ message: "Unable to assign EPC." });
  }
});

app.get("/api/pallets/:palletId/contents", async (req, res) => {
  const palletId = Number(req.params.palletId);
  if (!Number.isSafeInteger(palletId) || palletId <= 0) { res.status(400).json({ message: "Invalid pallet ID." }); return; }
  try {
    const pool = await getPool();
    const q = await pool.request().input("PalletId", sql.BigInt, palletId).query(
      "SELECT PalletContentId, PalletId, MaterialNumber, Quantity, Uom, IsActive, UpdatedAt FROM dbo.PalletContent WHERE PalletId=@PalletId ORDER BY MaterialNumber"
    );
    res.json(q.recordset);
  } catch (err) {
    console.error("List pallet contents failed", err);
    res.status(500).json({ message: "Unable to retrieve pallet contents." });
  }
});

app.post("/api/pallets/:palletId/contents", async (req, res) => {
  const palletId = Number(req.params.palletId);
  const materialNumber = textField(req.body?.materialNumber, 80);
  const uom = textField(req.body?.uom, 12);
  const quantity = Number(req.body?.quantity);
  if (!Number.isSafeInteger(palletId) || palletId <= 0 || !materialNumber || !uom ||
      !Number.isFinite(quantity) || quantity <= 0 || quantity > 99999999999999) {
    res.status(400).json({ message: "Provide a valid pallet ID, material number, positive quantity, and unit of measure." });
    return;
  }
  try {
    const pool = await getPool();
    const pallet = await pool.request().input("PalletId", sql.BigInt, palletId)
      .query("SELECT PalletId FROM dbo.Pallet WHERE PalletId=@PalletId AND Status <> 'INACTIVE'");
    if (!pallet.recordset.length) { res.status(404).json({ message: "Active pallet not found." }); return; }
    const q = await pool.request()
      .input("PalletId", sql.BigInt, palletId)
      .input("MaterialNumber", sql.NVarChar(80), materialNumber)
      .input("Quantity", sql.Decimal(18, 4), quantity)
      .input("Uom", sql.NVarChar(12), uom)
      .query(`INSERT INTO dbo.PalletContent (PalletId, MaterialNumber, Quantity, Uom)
              OUTPUT INSERTED.PalletContentId, INSERTED.PalletId, INSERTED.MaterialNumber, INSERTED.Quantity, INSERTED.Uom, INSERTED.IsActive
              VALUES (@PalletId, @MaterialNumber, @Quantity, @Uom)`);
    res.status(201).json(q.recordset[0]);
  } catch (err) {
    console.error("Add pallet content failed", err);
    res.status(500).json({ message: "Unable to add pallet content." });
  }
});

app.put("/api/pallet-contents/:contentId", async (req, res) => {
  const contentId = Number(req.params.contentId);
  const quantity = Number(req.body?.quantity);
  const isActive = req.body?.isActive;
  if (!Number.isSafeInteger(contentId) || contentId <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0 || typeof isActive !== "boolean") {
    res.status(400).json({ message: "Provide a valid content ID, positive quantity, and active status." });
    return;
  }
  try {
    const pool = await getPool();
    const q = await pool.request()
      .input("PalletContentId", sql.BigInt, contentId)
      .input("Quantity", sql.Decimal(18, 4), quantity)
      .input("IsActive", sql.Bit, isActive)
      .query(`UPDATE dbo.PalletContent SET Quantity=@Quantity, IsActive=@IsActive, UpdatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.PalletContentId, INSERTED.PalletId, INSERTED.MaterialNumber, INSERTED.Quantity, INSERTED.Uom, INSERTED.IsActive
              WHERE PalletContentId=@PalletContentId`);
    if (!q.recordset.length) { res.status(404).json({ message: "Pallet content line not found." }); return; }
    res.json(q.recordset[0]);
  } catch (err) {
    console.error("Update pallet content failed", err);
    res.status(500).json({ message: "Unable to update pallet content." });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log("PTMS API listening on port " + port));
