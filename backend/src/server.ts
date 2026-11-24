import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import sql from "mssql";
import { getPool } from "./config/db";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

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

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "ptms-api", version: "0.2.0" }));

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

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log("PTMS API listening on port " + port));
