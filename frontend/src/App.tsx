import { useEffect, useState } from "react";

type Site = {
  SiteId: number;
  SiteCode: string;
  SiteName: string;
  SiteType: "FACTORY" | "EXTERNAL_WAREHOUSE";
  IsActive: boolean;
  ZoneCount?: number;
};
type Zone = {
  ZoneId: number;
  SiteId: number;
  ZoneCode: string;
  ZoneName: string;
  ZoneType: string;
  IsActive: boolean;
};

const zoneTypes = ["RECEIVING", "STORAGE", "STAGING", "PRODUCTION", "DISPATCH", "OTHER"];

export default function App() {
  const [api, setApi] = useState("Checking…");
  const [db, setDb] = useState("Not checked");
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteForm, setSiteForm] = useState({ siteCode: "", siteName: "", siteType: "FACTORY" });
  const [zoneForm, setZoneForm] = useState({ zoneCode: "", zoneName: "", zoneType: "STORAGE" });

  async function loadSites() {
    const response = await fetch("/api/sites");
    if (!response.ok) throw new Error("Unable to load sites.");
    const data: Site[] = await response.json();
    setSites(data);
    if (selectedSite && !data.some(site => site.SiteId === selectedSite)) {
      setSelectedSite(null);
      setZones([]);
    }
    return data;
  }

  async function loadZones(siteId: number) {
    const response = await fetch(`/api/sites/${siteId}/zones`);
    if (!response.ok) throw new Error("Unable to load zones.");
    setZones(await response.json());
  }

  async function initialize() {
    try {
      const [health] = await Promise.all([
        fetch("/api/db/health").then(r => r.json()),
        fetch("/api/health").then(r => r.json()).then(d => setApi(d.status === "ok" ? "Online" : "Unavailable"))
      ]);
      if (health.status !== "connected") throw new Error("Database connection unavailable.");
      setDb("Connected — " + health.databaseName);
      await loadSites();
    } catch (e) {
      setDb("Not connected");
      setError(e instanceof Error ? e.message : "Unable to initialize PTMS.");
    }
  }

  useEffect(() => { void initialize(); }, []);

  async function submitSite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sites", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(siteForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create site.");
      setSiteForm({ siteCode: "", siteName: "", siteType: "FACTORY" });
      await loadSites();
      setSelectedSite(data.SiteId);
      await loadZones(data.SiteId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create site."); }
    finally { setBusy(false); }
  }

  async function submitZone(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSite) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sites/${selectedSite}/zones`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(zoneForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create zone.");
      setZoneForm({ zoneCode: "", zoneName: "", zoneType: "STORAGE" });
      await loadZones(selectedSite);
      await loadSites();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create zone."); }
    finally { setBusy(false); }
  }

  async function toggleSite(site: Site) {
    const confirmed = window.confirm(`${site.IsActive ? "Deactivate" : "Reactivate"} site ${site.SiteCode}?`);
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sites/${site.SiteId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteCode: site.SiteCode, siteName: site.SiteName, siteType: site.SiteType, isActive: !site.IsActive })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update site.");
      await loadSites();
      if (!data.IsActive && selectedSite === site.SiteId) { setSelectedSite(null); setZones([]); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update site."); }
    finally { setBusy(false); }
  }

  async function toggleZone(zone: Zone) {
    const confirmed = window.confirm(`${zone.IsActive ? "Deactivate" : "Reactivate"} zone ${zone.ZoneCode}?`);
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/zones/${zone.ZoneId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneCode: zone.ZoneCode, zoneName: zone.ZoneName, zoneType: zone.ZoneType, isActive: !zone.IsActive })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update zone.");
      if (selectedSite) await loadZones(selectedSite);
      await loadSites();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update zone."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setError("");
    try {
      const response = await fetch("/api/db/health");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Database unavailable.");
      setDb("Connected — " + data.databaseName);
      await loadSites();
      if (selectedSite) await loadZones(selectedSite);
    } catch (e) { setDb("Not connected"); setError(e instanceof Error ? e.message : "Refresh failed."); }
  }

  const activeSites = sites.filter(site => site.IsActive);
  const activeZones = zones.filter(zone => zone.IsActive);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="mark">PT</div>
        <div>
          <p className="eyebrow">PALLET TRACKING MANAGEMENT SYSTEM</p>
          <h1>PTMS Control Center</h1>
          <p className="sub">RFID-enabled pallet visibility across warehouses and factory zones</p>
        </div>
      </header>

      <section className="cards">
        <article className="card"><span>Application API</span><strong className={api === "Online" ? "good" : ""}>{api}</strong><small>Node.js · Express · TypeScript</small></article>
        <article className="card"><span>SQL Server</span><strong className={db.startsWith("Connected") ? "good" : ""}>{db}</strong><small>Microsoft SQL Server 2025</small><button onClick={refresh} disabled={busy}>Refresh connection</button></article>
        <article className="card"><span>Active sites</span><strong>{activeSites.length}</strong><small>{activeZones.length} active zones in selected site</small></article>
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      <section className="workspace">
        <div className="panel">
          <div className="panelhead"><div><p className="eyebrow">MASTER DATA · 01</p><h2>Site management</h2></div><span className="count">{activeSites.length} active</span></div>
          <form className="formgrid" onSubmit={submitSite}>
            <label>Site code<input required maxLength={30} value={siteForm.siteCode} onChange={e => setSiteForm({ ...siteForm, siteCode: e.target.value })} placeholder="e.g. PEN-F01" /></label>
            <label>Site name<input required maxLength={150} value={siteForm.siteName} onChange={e => setSiteForm({ ...siteForm, siteName: e.target.value })} placeholder="Factory or warehouse name" /></label>
            <label>Site type<select value={siteForm.siteType} onChange={e => setSiteForm({ ...siteForm, siteType: e.target.value })}><option value="FACTORY">Factory</option><option value="EXTERNAL_WAREHOUSE">External warehouse</option></select></label>
            <button type="submit" disabled={busy || !db.startsWith("Connected")}>Add site</button>
          </form>
          <div className="tablewrap">
            <table><thead><tr><th>Site code</th><th>Site name</th><th>Type</th><th>Zones</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{sites.map(site => <tr key={site.SiteId} className={selectedSite === site.SiteId ? "selected" : ""}>
                <td><button className="textbutton" onClick={() => { setSelectedSite(site.SiteId); void loadZones(site.SiteId).catch(e => setError(e.message)); }}>{site.SiteCode}</button></td>
                <td>{site.SiteName}</td><td>{site.SiteType === "FACTORY" ? "Factory" : "External warehouse"}</td><td>{site.ZoneCount ?? "—"}</td>
                <td><span className={site.IsActive ? "status active" : "status inactive"}>{site.IsActive ? "Active" : "Inactive"}</span></td>
                <td><button className="secondary" disabled={busy} onClick={() => void toggleSite(site)}>{site.IsActive ? "Deactivate" : "Reactivate"}</button></td>
              </tr>)}</tbody>
            </table>
            {sites.length === 0 && <div className="empty">No sites registered yet. Add your first factory or external warehouse above.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panelhead"><div><p className="eyebrow">MASTER DATA · 02</p><h2>Zone management</h2><p className="sub">Zones are maintained within an individual site.</p></div><span className="count">{activeZones.length} active</span></div>
          {!selectedSite ? <div className="empty">Select a site from the table to view and manage its zones.</div> : <>
            <form className="formgrid" onSubmit={submitZone}>
              <label>Zone code<input required maxLength={40} value={zoneForm.zoneCode} onChange={e => setZoneForm({ ...zoneForm, zoneCode: e.target.value })} placeholder="e.g. WH-A-01" /></label>
              <label>Zone name<input required maxLength={150} value={zoneForm.zoneName} onChange={e => setZoneForm({ ...zoneForm, zoneName: e.target.value })} placeholder="Receiving, storage, dispatch…" /></label>
              <label>Zone type<select value={zoneForm.zoneType} onChange={e => setZoneForm({ ...zoneForm, zoneType: e.target.value })}>{zoneTypes.map(type => <option key={type} value={type}>{type.replace("_", " ")}</option>)}</select></label>
              <button type="submit" disabled={busy}>Add zone</button>
            </form>
            <div className="tablewrap">
              <table><thead><tr><th>Zone code</th><th>Zone name</th><th>Zone type</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{zones.map(zone => <tr key={zone.ZoneId}><td>{zone.ZoneCode}</td><td>{zone.ZoneName}</td><td>{zone.ZoneType}</td><td><span className={zone.IsActive ? "status active" : "status inactive"}>{zone.IsActive ? "Active" : "Inactive"}</span></td><td><button className="secondary" disabled={busy} onClick={() => void toggleZone(zone)}>{zone.IsActive ? "Deactivate" : "Reactivate"}</button></td></tr>)}</tbody>
              </table>
              {zones.length === 0 && <div className="empty">No zones registered for this site.</div>}
            </div>
          </>}
        </div>
      </section>
      <footer>PTMS · v0.2.0 · Raw RFID reads are not treated as confirmed pallet movements.</footer>
    </main>
  );
}
