import { useEffect, useState, type FormEvent } from "react";

type Site = {
  SiteId: number;
  SiteCode: string;
  SiteName: string;
  SiteType: "FACTORY" | "EXTERNAL_WAREHOUSE";
  IsActive: boolean;
  ZoneCount?: number;
};
type Pallet = { PalletId: number; PalletCode: string; PalletType: string; Status: string; ZoneCode?: string; ZoneName?: string; SiteCode?: string; ActiveEpc?: string; ActiveMaterialLines: number };
type PalletContent = { PalletContentId: number; MaterialNumber: string; Quantity: number; Uom: string; IsActive: boolean };
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
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [selectedPallet, setSelectedPallet] = useState<number | null>(null);
  const [palletContents, setPalletContents] = useState<PalletContent[]>([]);
  const [palletForm, setPalletForm] = useState({ palletCode: "", palletType: "MATERIAL" });
  const [epcInput, setEpcInput] = useState("");
  const [contentForm, setContentForm] = useState({ materialNumber: "", quantity: "1", uom: "EA" });

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

  async function loadPallets() {
    const response = await fetch("/api/pallets");
    if (!response.ok) throw new Error("Unable to load pallets.");
    setPallets(await response.json());
  }

  async function loadPalletContents(palletId: number) {
    const response = await fetch(`/api/pallets/${palletId}/contents`);
    if (!response.ok) throw new Error("Unable to load pallet contents.");
    setPalletContents(await response.json());
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

  async function submitSite(event: FormEvent) {
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

  async function submitPallet(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pallets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...palletForm, currentZoneId: selectedSite ? (document.getElementById("pallet-zone") as HTMLSelectElement).value || null : null })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to register pallet.");
      setPalletForm({ palletCode: "", palletType: "MATERIAL" });
      await loadPallets();
      setSelectedPallet(data.PalletId);
      await loadPalletContents(data.PalletId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to register pallet."); }
    finally { setBusy(false); }
  }

  async function assignEpc(event: FormEvent) {
    event.preventDefault();
    if (!selectedPallet) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/pallets/${selectedPallet}/epc`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epc: epcInput })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to assign EPC.");
      setEpcInput("");
      await loadPallets();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to assign EPC."); }
    finally { setBusy(false); }
  }

  async function addPalletContent(event: FormEvent) {
    event.preventDefault();
    if (!selectedPallet) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/pallets/${selectedPallet}/contents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contentForm, quantity: Number(contentForm.quantity) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to add material.");
      setContentForm({ materialNumber: "", quantity: "1", uom: "EA" });
      await loadPalletContents(selectedPallet);
      await loadPallets();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add material."); }
    finally { setBusy(false); }
  }

  async function toggleContent(item: PalletContent) {
    if (!selectedPallet) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/pallet-contents/${item.PalletContentId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.Quantity, isActive: !item.IsActive })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to update material line.");
      await loadPalletContents(selectedPallet);
      await loadPallets();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update material line."); }
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
  const activeZones = zones.filter(zone => zone.IsActive);\n  const activePallets = pallets.filter(pallet => pallet.Status !== "INACTIVE");\n  const chosenPallet = pallets.find(pallet => pallet.PalletId === selectedPallet);

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
      <section className="panel pallet-panel">
        <div className="panelhead"><div><p className="eyebrow">MASTER DATA · 03</p><h2>Pallet registration & identification</h2><p className="sub">Register material pallets, assign one active RFID EPC and maintain pallet contents.</p></div><span className="count">{activePallets.length} active pallets</span></div>
        <form className="formgrid" onSubmit={submitPallet}>
          <label>Pallet ID / code<input required maxLength={50} value={palletForm.palletCode} onChange={e => setPalletForm({ ...palletForm, palletCode: e.target.value })} placeholder="e.g. PLT-000001" /></label>
          <label>Pallet type<input required maxLength={40} value={palletForm.palletType} onChange={e => setPalletForm({ ...palletForm, palletType: e.target.value })} placeholder="MATERIAL" /></label>
          <label>Initial zone<select id="pallet-zone" defaultValue=""><option value="">Not assigned</option>{activeZones.map(zone => <option key={zone.ZoneId} value={zone.ZoneId}>{zone.ZoneCode} · {zone.ZoneName}</option>)}</select></label>
          <button type="submit" disabled={busy || !db.startsWith("Connected")}>Register pallet</button>
        </form>
        <div className="tablewrap">
          <table><thead><tr><th>Pallet code</th><th>Type</th><th>Current site / zone</th><th>Active EPC</th><th>Material lines</th><th>Status</th></tr></thead>
            <tbody>{pallets.map(pallet => <tr key={pallet.PalletId} className={selectedPallet === pallet.PalletId ? "selected" : ""}>
              <td><button className="textbutton" onClick={() => { setSelectedPallet(pallet.PalletId); void loadPalletContents(pallet.PalletId).catch(e => setError(e.message)); }}>{pallet.PalletCode}</button></td>
              <td>{pallet.PalletType}</td><td>{pallet.SiteCode ? `${pallet.SiteCode} / ${pallet.ZoneCode}` : "Unassigned"}</td><td>{pallet.ActiveEpc || "Not assigned"}</td><td>{pallet.ActiveMaterialLines}</td><td><span className="status active">{pallet.Status}</span></td>
            </tr>)}</tbody>
          </table>
          {pallets.length === 0 && <div className="empty">No pallets registered yet. Register the first material pallet above.</div>}
        </div>
        {!selectedPallet ? <div className="empty" style={{ marginTop: 14 }}>Select a pallet to assign an RFID EPC and manage its material contents.</div> : <>
          <div className="pallet-detail">
            <div><p className="eyebrow">SELECTED PALLET</p><h3>{chosenPallet?.PalletCode || `Pallet #${selectedPallet}`}</h3><p className="sub">EPC assignment history is retained when an EPC is replaced.</p></div>
            <form className="inlineform" onSubmit={assignEpc}>
              <label>RFID EPC<input required maxLength={128} value={epcInput} onChange={e => setEpcInput(e.target.value)} placeholder="Scan or enter EPC" /></label>
              <button type="submit" disabled={busy}>Assign / replace EPC</button>
            </form>
          </div>
          <div className="pallet-detail">
            <div><p className="eyebrow">PALLET CONTENTS</p><h3>Material numbers</h3><p className="sub">A pallet can contain one or multiple material numbers.</p></div>
            <form className="inlineform" onSubmit={addPalletContent}>
              <label>Material number<input required maxLength={80} value={contentForm.materialNumber} onChange={e => setContentForm({ ...contentForm, materialNumber: e.target.value })} placeholder="Scan or enter material number" /></label>
              <label>Quantity<input required type="number" min="0.0001" step="0.0001" value={contentForm.quantity} onChange={e => setContentForm({ ...contentForm, quantity: e.target.value })} /></label>
              <label>UOM<input required maxLength={12} value={contentForm.uom} onChange={e => setContentForm({ ...contentForm, uom: e.target.value })} /></label>
              <button type="submit" disabled={busy}>Add material</button>
            </form>
          </div>
          <div className="tablewrap">
            <table><thead><tr><th>Material number</th><th>Quantity</th><th>UOM</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{palletContents.map(item => <tr key={item.PalletContentId}><td>{item.MaterialNumber}</td><td>{item.Quantity}</td><td>{item.Uom}</td><td><span className={item.IsActive ? "status active" : "status inactive"}>{item.IsActive ? "Active" : "Inactive"}</span></td><td><button className="secondary" disabled={busy} onClick={() => void toggleContent(item)}>{item.IsActive ? "Remove" : "Restore"}</button></td></tr>)}</tbody>
            </table>
            {palletContents.length === 0 && <div className="empty">No material content recorded for this pallet.</div>}
          </div>
        </>}
      </section>
      <footer>PTMS · v0.3.0 · Raw RFID reads are not treated as confirmed pallet movements.</footer>
    </main>
  );
}
