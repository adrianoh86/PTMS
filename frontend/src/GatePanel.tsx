import { useEffect, useState, type FormEvent } from "react";

type Site = { SiteId: number; SiteCode: string; IsActive: boolean };
type Zone = { ZoneId: number; ZoneCode: string; ZoneName: string; IsActive: boolean; SiteCode: string };
type Reader = { ReaderId: number; ReaderCode: string; IsActive: boolean };
type Antenna = { antennaNo: number; side: "A" | "B"; direction?: string };
type Gate = {
  GateId: string; GateCode: string; GateName: string; ReaderId: number; ReaderCode: string;
  FromZoneId: string; FromZoneCode: string; FromZoneName: string; FromSiteCode: string;
  ToZoneId: string; ToZoneCode: string; ToZoneName: string; ToSiteCode: string;
  IsActive: boolean; antennas: Antenna[];
};

const initialForm = { gateCode: "", gateName: "", readerId: "", fromZoneId: "", toZoneId: "", sideAAntennas: "1", sideBAntennas: "2" };

function parseNumbers(value: string, side: "A" | "B"): Antenna[] {
  return value.split(",").map(v => v.trim()).filter(Boolean).map(v => ({ antennaNo: Number(v), side }));
}

export default function GatePanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [readers, setReaders] = useState<Reader[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [siteRes, readerRes, gateRes] = await Promise.all([fetch("/api/sites"), fetch("/api/rfid/readers"), fetch("/api/rfid/gates")]);
    if (!siteRes.ok || !readerRes.ok || !gateRes.ok) throw new Error("Unable to load gate configuration data.");
    const siteRows: Site[] = await siteRes.json();
    const readerRows: Reader[] = await readerRes.json();
    const zoneGroups = await Promise.all(siteRows.filter(s => s.IsActive).map(async s => {
      const r = await fetch(`/api/sites/${s.SiteId}/zones`);
      if (!r.ok) return [];
      const rows: Zone[] = await r.json();
      return rows.filter(z => z.IsActive).map(z => ({ ...z, SiteCode: s.SiteCode }));
    }));
    setSites(siteRows);
    setZones(zoneGroups.flat());
    setReaders(readerRows);
    setGates(await gateRes.json());
  }

  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "Gate configuration load failed.")); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const antennas = [...parseNumbers(form.sideAAntennas, "A"), ...parseNumbers(form.sideBAntennas, "B")];
    try {
      const response = await fetch("/api/rfid/gates", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateCode: form.gateCode, gateName: form.gateName, readerId: Number(form.readerId),
          fromZoneId: Number(form.fromZoneId), toZoneId: Number(form.toZoneId), antennas }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create gate.");
      setForm(initialForm);
      setMessage(`Gate ${data.gateCode} configured. A → B = IN; B → A = OUT.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create gate."); }
    finally { setBusy(false); }
  }

  const activeReaders = readers.filter(r => r.IsActive);
  return <section className="panel gate-panel">
    <div className="panelhead"><div><p className="eyebrow">RFID MIDDLEWARE · 05</p><h2>Gate configuration & antenna mapping</h2><p className="sub">Configure the reader, connected zones and antenna-side direction rules. This does not trigger pallet movements.</p></div><span className="count">{gates.filter(g => g.IsActive).length} active gates</span></div>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    <form className="formgrid gate-form" onSubmit={submit}>
      <label>Gate code<input required maxLength={50} value={form.gateCode} onChange={e=>setForm({...form,gateCode:e.target.value})} placeholder="e.g. PEN-GATE-01"/></label>
      <label>Gate name<input required maxLength={150} value={form.gateName} onChange={e=>setForm({...form,gateName:e.target.value})} placeholder="Material receiving gate"/></label>
      <label>RFID reader<select required value={form.readerId} onChange={e=>setForm({...form,readerId:e.target.value})}><option value="">Select active reader</option>{activeReaders.map(r=><option key={r.ReaderId} value={r.ReaderId}>{r.ReaderCode}</option>)}</select></label>
      <label>Side A / source zone<select required value={form.fromZoneId} onChange={e=>setForm({...form,fromZoneId:e.target.value})}><option value="">Select source zone</option>{zones.map(z=><option key={z.ZoneId} value={z.ZoneId}>{z.SiteCode} / {z.ZoneCode} · {z.ZoneName}</option>)}</select></label>
      <label>Side B / destination zone<select required value={form.toZoneId} onChange={e=>setForm({...form,toZoneId:e.target.value})}><option value="">Select destination zone</option>{zones.map(z=><option key={z.ZoneId} value={z.ZoneId}>{z.SiteCode} / {z.ZoneCode} · {z.ZoneName}</option>)}</select></label>
      <label>Side A antenna numbers<input required value={form.sideAAntennas} onChange={e=>setForm({...form,sideAAntennas:e.target.value})} placeholder="1,2"/></label>
      <label>Side B antenna numbers<input required value={form.sideBAntennas} onChange={e=>setForm({...form,sideBAntennas:e.target.value})} placeholder="3,4"/></label>
      <button type="submit" disabled={busy || !activeReaders.length || zones.length < 2}>Create gate configuration</button>
    </form>
    <div className="gate-rules"><strong>Direction convention:</strong> Side A is the source zone and Side B is the destination zone. A → B is IN; B → A is OUT. Multiple antennas can be assigned to each side. Antenna numbers must be unique within the gate.</div>
    <div className="tablewrap">
      <table><thead><tr><th>Gate</th><th>Reader</th><th>Side A / source</th><th>Side B / destination</th><th>Antenna mapping</th><th>Status</th></tr></thead>
        <tbody>{gates.map(g=><tr key={g.GateId}><td><strong>{g.GateCode}</strong><br/>{g.GateName}</td><td>{g.ReaderCode}</td><td>{g.FromSiteCode} / {g.FromZoneCode}</td><td>{g.ToSiteCode} / {g.ToZoneCode}</td><td>{g.antennas.map(a=>`A${a.antennaNo}→${a.side}`).join(", ")}<br/><small>A→B IN · B→A OUT</small></td><td><span className={g.IsActive ? "status active" : "status inactive"}>{g.IsActive ? "Active" : "Inactive"}</span></td></tr>)}</tbody>
      </table>
      {gates.length===0 && <div className="empty">No RFID gates configured. Register a reader first, then create a gate.</div>}
    </div>
    <p className="rfid-footnote">Configuration only: raw reads remain observations. Gate session correlation, direction confidence and confirmed movement are later milestones.</p>
  </section>;
}
