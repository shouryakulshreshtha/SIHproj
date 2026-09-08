import React, { useState } from "react";
import {
  Truck, LayoutDashboard, Route, Users, IndianRupee, BarChart3,
  CheckCircle2, XCircle, Clock, AlertTriangle, Search, Bell,
} from "lucide-react";

const headlineFont = { fontFamily: "'Barlow Condensed', sans-serif" };

const STATS = [
  { label: "Active trips", value: "142", change: "+12 today" },
  { label: "Revenue today", value: "₹3.8L", change: "+8% vs yesterday" },
  { label: "Active drivers", value: "389", change: "23 on relay legs" },
  { label: "Pending verifications", value: "17", change: "6 urgent" },
];

const TRIPS = [
  { id: "RF4821", route: "Ludhiana → Ambala", type: "Relay", segments: 3, currentSegment: 2, status: "In transit", driver: "Manoj Kumar" },
  { id: "RF4819", route: "Delhi → Jaipur", type: "Single", segments: 1, currentSegment: 1, status: "In transit", driver: "Suresh Yadav" },
  { id: "RF4815", route: "Chandigarh → Delhi", type: "Relay", segments: 2, currentSegment: 2, status: "Delivered", driver: "Ranjit Singh" },
  { id: "RF4808", route: "Ludhiana → Mumbai", type: "Relay", segments: 5, currentSegment: 3, status: "Delayed", driver: "Harpreet Sidhu" },
  { id: "RF4801", route: "Patiala → Chandigarh", type: "Single", segments: 1, currentSegment: 0, status: "Assigned", driver: "Manoj Kumar" },
];

const VERIFICATIONS = [
  { name: "Baljeet Singh", doc: "Driving license", submitted: "2 hours ago", urgent: true },
  { name: "Ramesh Chand", doc: "Vehicle RC", submitted: "5 hours ago", urgent: false },
  { name: "Ajay Verma", doc: "Insurance certificate", submitted: "1 day ago", urgent: true },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [verifications, setVerifications] = useState(VERIFICATIONS);

  function decideVerification(index, approved) {
    setVerifications((v) => v.filter((_, i) => i !== index));
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <Sidebar tab={tab} setTab={setTab} />
      <main className="flex-1 p-8 pl-64">
        <TopBar />
        {tab === "overview" && <Overview verifications={verifications} onDecide={decideVerification} />}
        {tab === "trips" && <TripsTable />}
        {tab === "drivers" && <DriversTab verifications={verifications} onDecide={decideVerification} />}
        {tab === "pricing" && <PricingTab />}
      </main>
    </div>
  );
}

function Sidebar({ tab, setTab }) {
  const items = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "trips", label: "Trips", icon: Route },
    { id: "drivers", label: "Drivers", icon: Users },
    { id: "pricing", label: "Pricing", icon: IndianRupee },
  ];
  return (
    <aside className="w-56 fixed left-0 top-0 bottom-0 bg-slate-800 border-r border-slate-700 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-8">
        <div className="bg-amber-400 rounded-md p-1.5">
          <Truck className="w-4 h-4 text-slate-900" strokeWidth={2.5} />
        </div>
        <span className="text-white text-sm font-medium" style={headlineFont}>Relay Freight</span>
      </div>
      <nav className="space-y-1">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
              tab === id ? "bg-amber-400/10 text-amber-400" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-2 pt-4 border-t border-slate-700">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-xs font-medium">A</div>
        <div>
          <p className="text-slate-200 text-xs">Admin</p>
          <p className="text-slate-600 text-xs">Ops team</p>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center bg-slate-800 border border-slate-700 rounded-md px-3 py-2 w-80">
        <Search className="w-4 h-4 text-slate-500 mr-2" />
        <input placeholder="Search trip ID, driver, hub…" className="bg-transparent text-sm text-white placeholder-slate-600 outline-none flex-1" />
      </div>
      <button className="relative bg-slate-800 border border-slate-700 rounded-md p-2.5">
        <Bell className="w-4 h-4 text-slate-400" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full text-[10px] text-white flex items-center justify-center">3</span>
      </button>
    </div>
  );
}

function Overview({ verifications, onDecide }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-slate-800 border border-slate-700 rounded-lg p-5">
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-3xl text-white" style={headlineFont}>{s.value}</p>
            <p className="text-emerald-400 text-xs mt-1">{s.change}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg text-white" style={headlineFont}>Live relay trips</h2>
            <BarChart3 className="w-4 h-4 text-slate-500" />
          </div>
          <div className="space-y-3">
            {TRIPS.filter((t) => t.type === "Relay").map((t) => (
              <RelayRow key={t.id} trip={t} />
            ))}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <h2 className="text-lg text-white mb-4" style={headlineFont}>Pending verifications</h2>
          <div className="space-y-3">
            {verifications.length === 0 && <p className="text-slate-500 text-sm">All caught up.</p>}
            {verifications.map((v, i) => (
              <div key={v.name} className="bg-slate-900 rounded-md p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-slate-200 text-sm">{v.name}</p>
                  {v.urgent && <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />}
                </div>
                <p className="text-slate-500 text-xs mb-3">{v.doc} · {v.submitted}</p>
                <div className="flex gap-2">
                  <button onClick={() => onDecide(i, false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors">
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                  <button onClick={() => onDecide(i, true)} className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors">
                    <CheckCircle2 className="w-3 h-3" /> Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RelayRow({ trip }) {
  return (
    <div className="bg-slate-900 rounded-md p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-200 text-sm font-medium">{trip.id}</span>
        <StatusBadge status={trip.status} />
      </div>
      <p className="text-slate-400 text-xs mb-3">{trip.route} · Driver: {trip.driver}</p>
      <div className="flex gap-1">
        {Array.from({ length: trip.segments }).map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < trip.currentSegment ? "bg-amber-400" : "bg-slate-700"}`} />
        ))}
      </div>
      <p className="text-slate-600 text-xs mt-1.5">Segment {trip.currentSegment} of {trip.segments}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    "In transit": "bg-amber-400/20 text-amber-400",
    "Delivered": "bg-emerald-500/20 text-emerald-400",
    "Delayed": "bg-orange-500/20 text-orange-400",
    "Assigned": "bg-slate-700 text-slate-300",
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status]}`}>{status}</span>;
}

function TripsTable() {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <div className="p-5 border-b border-slate-700">
        <h2 className="text-lg text-white" style={headlineFont}>All trips</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-500 text-xs uppercase tracking-wide">
            <th className="text-left font-medium px-5 py-3">Trip ID</th>
            <th className="text-left font-medium px-5 py-3">Route</th>
            <th className="text-left font-medium px-5 py-3">Type</th>
            <th className="text-left font-medium px-5 py-3">Driver</th>
            <th className="text-left font-medium px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {TRIPS.map((t) => (
            <tr key={t.id} className="border-t border-slate-700/60 hover:bg-slate-900/40">
              <td className="px-5 py-3 text-slate-200">{t.id}</td>
              <td className="px-5 py-3 text-slate-300">{t.route}</td>
              <td className="px-5 py-3 text-slate-400">{t.type === "Relay" ? `Relay · ${t.segments} segs` : "Single"}</td>
              <td className="px-5 py-3 text-slate-400">{t.driver}</td>
              <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriversTab({ verifications, onDecide }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
      <h2 className="text-lg text-white mb-4" style={headlineFont}>Document verification queue</h2>
      <div className="space-y-3">
        {verifications.length === 0 && <p className="text-slate-500 text-sm">No pending verifications.</p>}
        {verifications.map((v, i) => (
          <div key={v.name} className="flex items-center justify-between bg-slate-900 rounded-md p-4">
            <div>
              <p className="text-slate-200 text-sm font-medium">{v.name}</p>
              <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5">
                <Clock className="w-3 h-3" /> {v.doc} · {v.submitted}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onDecide(i, false)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors">
                <XCircle className="w-3 h-3" /> Reject
              </button>
              <button onClick={() => onDecide(i, true)} className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors">
                <CheckCircle2 className="w-3 h-3" /> Approve
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingTab() {
  const [baseFare, setBaseFare] = useState(300);
  const [nightSurcharge, setNightSurcharge] = useState(15);
  const [saved, setSaved] = useState(false);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md">
      <h2 className="text-lg text-white mb-5" style={headlineFont}>Pricing rules</h2>
      <div className="space-y-4">
        <div>
          <label className="text-slate-400 text-xs block mb-1.5">Base fare (₹)</label>
          <input type="number" value={baseFare} onChange={(e) => setBaseFare(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" />
        </div>
        <div>
          <label className="text-slate-400 text-xs block mb-1.5">Night surcharge (%)</label>
          <input type="number" value={nightSurcharge} onChange={(e) => setNightSurcharge(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" />
        </div>
        <button onClick={() => setSaved(true)} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-2.5 rounded-md text-sm transition-colors">
          Save pricing rules
        </button>
        {saved && <p className="text-emerald-400 text-xs text-center">Saved.</p>}
      </div>
    </div>
  );
}
