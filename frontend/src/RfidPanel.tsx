import { useEffect, useState, type FormEvent } from "react";

type ZoneOption = { ZoneId: number; ZoneCode: string; ZoneName: string; SiteCode: string };
type Reader = {
  ReaderId: number; ReaderCode: string; ZoneId: number; ZoneCode: string; ZoneName: string;
  ReaderVendor?: string; ReaderModel?: string; IntegrationMode: string; ConnectionEndpoint?: string;
  SerialNumber?: string; IsActive: boolean; LastHeartbeatAt?: string; LastError?: string;
};
type RawEvent = {
  RawEventId: string; SourceEventKey?: string; Epc: string; ReaderCode?: string;
  AntennaNo?: number; Rssi?: number; ObservedAt: string; ReceivedAt: string; ProcessingStatus: string;
};

export default function RfidPanel() {
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [readers, setReaders] = useState<Reader[]>([]);
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [selectedReader, setSelectedReader] = useState("");
  const [form, setForm] = useState({ readerCode: "", zoneId: "", readerVendor: "", readerModel: "", integrationMode: "HTTP", connectionEndpoint: "", serialNumber: "" });
  const [epc, setEpc] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [readerResponse, siteResponse, eventResponse] = await Promise.all([
      fetch("/api/rfid/readers"), fetch("/api/sites"), fetch("/api/rfid/events?limit=30")
    ]);
    if (!readerResponse.ok || !siteResponse.ok || !eventResponse.ok) throw new Error("Unable to load RFID middleware data.");
    const readerData: Reader[] = await readerResponse.json();
    const sites: Array<{SiteId:number;SiteCode:string;IsActive:boolean}> = await siteResponse.json();
    const zoneGroups = await Promise.all(sites.filter(s => s.IsActive).map(async site => {
      const response = await fetch(`/api/sites/${site.SiteId}/zones`);
      if (!response.ok) return [];
      const rows: Array<{ZoneId:number;ZoneCode:string;ZoneName:string;IsActive:boolean}> = await response.json();
      return rows.filter(z => z.IsActive).map(z => ({ ...z, SiteCode: site.SiteCode }));
    }));
    setReaders(readerData);
    setZones(zoneGroups.flat());
    setEvents(await eventResponse.json());
    if (!selectedReader && readerData.length) setSelectedReader(readerData[0].ReaderCode);
  }

  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "RFID data load failed.")); }, []);

  async function createReader(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rfid/readers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, zoneId: Number(form.zoneId) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create reader.");
      setForm({ readerCode: "", zoneId: "", readerVendor: "", readerModel: "", integrationMode: "HTTP", connectionEndpoint: "", serialNumber: "" });
      setMessage("RFID reader registered.");
      await load();
      setSelectedReader(data.ReaderCode);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create reader."); }
    finally { setBusy(false); }
  }

  async function sendTestRead(event: FormEvent) {
    event.preventDefault();
    if (!selectedReader || !epc.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const sourceEventKey = `PTMS-TEST-${selectedReader}-${Date.now()}`;
      const response = await fetch("/api/rfid/events", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readerCode: selectedReader, events: [{ sourceEventKey, epc: epc.trim(), antennaNo: 1, rssi: -48.5, observedAt: new Date().toISOString(), rawPayload: { source: "PTMS dashboard test", adapter: "HTTP" } }] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to ingest test read.");
      setMessage(`Raw event accepted: ${data.accepted}; duplicates: ${data.duplicates}. Pallet location was not changed.`);
      setEpc("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "RFID test read failed."); }
    finally { setBusy(false); }
  }

  return <section className="panel rfid-panel">
    <div className="panelhead"><div><p className="eyebrow">RFID MIDDLEWARE · 04</p><h2>Reader management & raw EPC events</h2><p className="sub">Hybrid adapter foundation: vendor SDK, LLRP, MQTT and normalized HTTP ingestion.</p></div><span className="count">{readers.filter(r => r.IsActive).length} active readers</span></div>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    <form className="formgrid rfid-form" onSubmit={createReader}>
      <label>Reader code<input required maxLength={50} value={form.readerCode} onChange={e=>setForm({...form,readerCode:e.target.value})} placeholder="e.g. PEN-GATE-IN-01"/></label>
      <label>Zone<select required value={form.zoneId} onChange={e=>setForm({...form,zoneId:e.target.value})}><option value="">Select zone</option>{zones.map(z=><option key={z.ZoneId} value={z.ZoneId}>{z.SiteCode} / {z.ZoneCode} · {z.ZoneName}</option>)}</select></label>
      <label>Integration mode<select value={form.integrationMode} onChange={e=>setForm({...form,integrationMode:e.target.value})}><option>HTTP</option><option>VENDOR_SDK</option><option>LLRP</option><option>MQTT</option></select></label>
      <label>Vendor<input maxLength={80} value={form.readerVendor} onChange={e=>setForm({...form,readerVendor:e.target.value})} placeholder="e.g. Impinj"/></label>
      <label>Reader model<input maxLength={100} value={form.readerModel} onChange={e=>setForm({...form,readerModel:e.target.value})} placeholder="Model"/></label>
      <label>Serial number<input maxLength={100} value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})} placeholder="Optional"/></label>
      <label>Connection endpoint<input maxLength={500} value={form.connectionEndpoint} onChange={e=>setForm({...form,connectionEndpoint:e.target.value})} placeholder="Host, URL or broker/topic"/></label>
      <button type="submit" disabled={busy || zones.length===0}>Register reader</button>
    </form>
    <div className="tablewrap">
      <table><thead><tr><th>Reader</th><th>Location</th><th>Vendor / model</th><th>Mode</th><th>Heartbeat</th><th>Status</th></tr></thead>
        <tbody>{readers.map(r=><tr key={r.ReaderId}><td>{r.ReaderCode}</td><td>{r.ZoneCode} · {r.ZoneName}</td><td>{[r.ReaderVendor,r.ReaderModel].filter(Boolean).join(" / ") || "—"}</td><td>{r.IntegrationMode}</td><td>{r.LastHeartbeatAt ? new Date(r.LastHeartbeatAt).toLocaleString() : "Never"}</td><td><span className={r.IsActive ? "status active" : "status inactive"}>{r.IsActive ? "Active" : "Inactive"}</span></td></tr>)}</tbody>
      </table>
      {readers.length===0 && <div className="empty">No RFID readers configured yet. Register a reader above.</div>}
    </div>
    <div className="rfid-test">
      <div><p className="eyebrow">NORMALIZED INGESTION TEST</p><h3>Submit a test EPC observation</h3><p className="sub">This sends one HTTP adapter event into the raw-event table. It does not confirm a movement.</p></div>
      <form className="inlineform" onSubmit={sendTestRead}>
        <label>Reader<select required value={selectedReader} onChange={e=>setSelectedReader(e.target.value)}><option value="">Select reader</option>{readers.filter(r=>r.IsActive).map(r=><option key={r.ReaderId} value={r.ReaderCode}>{r.ReaderCode}</option>)}</select></label>
        <label>EPC<input required maxLength={128} value={epc} onChange={e=>setEpc(e.target.value)} placeholder="Scan or enter EPC"/></label>
        <button type="submit" disabled={busy || !selectedReader}>Ingest raw read</button>
      </form>
    </div>
    <div className="tablewrap">
      <table><thead><tr><th>Raw event</th><th>Reader</th><th>EPC</th><th>Antenna</th><th>RSSI</th><th>Observed</th><th>Processing</th></tr></thead>
        <tbody>{events.map(e=><tr key={e.RawEventId}><td>{e.RawEventId}</td><td>{e.ReaderCode || "—"}</td><td>{e.Epc}</td><td>{e.AntennaNo ?? "—"}</td><td>{e.Rssi ?? "—"}</td><td>{new Date(e.ObservedAt).toLocaleString()}</td><td>{e.ProcessingStatus}</td></tr>)}</tbody>
      </table>
      {events.length===0 && <div className="empty">No raw EPC observations received.</div>}
    </div>
    <p className="rfid-footnote">Safety rule: raw EPC observations are evidence only. They never update Pallet.CurrentZoneId or create PalletMovement records.</p>
  </section>;
}
