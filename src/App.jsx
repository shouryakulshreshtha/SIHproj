import React, { useState } from "react";
import ShipperApp from "./ShipperApp";
import DriverApp from "./DriverApp";
import AdminDashboard from "./AdminDashboard";

// Lets you flip between the three apps for demo/testing without touching code.
// Your team leader can swap this out later for real routing (react-router) if needed.
export default function App() {
  const [app, setApp] = useState("shipper"); // "shipper" | "driver" | "admin"

  return (
    <div>
      <div className="fixed top-3 left-3 z-50 flex gap-1 bg-slate-800 border border-slate-700 rounded-md p-1">
        {[
          { id: "shipper", label: "Shipper" },
          { id: "driver", label: "Driver" },
          { id: "admin", label: "Admin" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setApp(id)}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              app === id ? "bg-amber-400 text-slate-900 font-medium" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {app === "shipper" && <ShipperApp />}
      {app === "driver" && <DriverApp />}
      {app === "admin" && <AdminDashboard />}
    </div>
  );
}
