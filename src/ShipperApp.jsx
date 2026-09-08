import React, { useState, useRef } from "react";
import {
  Truck, Phone, ArrowRight, ArrowLeft, ShieldCheck, MapPin, Package,
  Boxes, Container, Clock, CheckCircle2, Circle, History, Home,
  Navigation, User,
} from "lucide-react";

const headlineFont = { fontFamily: "'Barlow Condensed', sans-serif" };

const VEHICLE_TYPES = [
  { id: "mini", label: "Mini Truck", capacity: "750 kg", ratePerKm: 15, icon: Truck },
  { id: "tempo14", label: "14-ft Tempo", capacity: "3.5 tons", ratePerKm: 22, icon: Package },
  { id: "truck19", label: "19-ft Truck", capacity: "9 tons", ratePerKm: 30, icon: Boxes },
  { id: "container", label: "Container", capacity: "16 tons", ratePerKm: 40, icon: Container },
];

const BASE_FARE = 300;
const DRIVER_NAMES = ["Ranjit Singh", "Manoj Kumar", "Suresh Yadav", "Harpreet Sidhu"];

// Demo-only stand-in for a real distance/routing API
function estimateDistanceKm(pickup, drop) {
  const seed = (pickup.length * 17 + drop.length * 23) % 500;
  return 80 + seed;
}

function buildTrip({ pickup, drop, vehicle, tripType, instructions }) {
  const distance = estimateDistanceKm(pickup, drop);
  const rate = VEHICLE_TYPES.find((v) => v.id === vehicle).ratePerKm;
  const fare = BASE_FARE + distance * rate;
  const segments = tripType === "relay" ? Math.max(2, Math.ceil(distance / 250)) : 1;
  const hubs = Array.from({ length: segments - 1 }, (_, i) => `Relay Hub ${i + 1}`);
  const drivers = Array.from({ length: segments }, (_, i) => DRIVER_NAMES[i % DRIVER_NAMES.length]);
  return {
    id: `RF${Math.floor(1000 + Math.random() * 9000)}`,
    pickup, drop, vehicle, tripType, instructions,
    distance, fare, segments, hubs, drivers,
    currentSegment: 1,
    status: "assigned", // assigned -> in_transit -> delivered
    createdAt: new Date(),
  };
}

export default function ShipperApp() {
  const [screen, setScreen] = useState("login");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const otpRefs = useRef([]);

  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [vehicle, setVehicle] = useState("mini");
  const [tripType, setTripType] = useState("single");
  const [instructions, setInstructions] = useState("");
  const [bookingError, setBookingError] = useState("");

  const [activeTrip, setActiveTrip] = useState(null);
  const [tripHistory, setTripHistory] = useState([]);

  function handleSendOtp(e) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return setError("Enter a valid 10-digit mobile number");
    setError("");
    setScreen("otp");
  }

  function handleOtpChange(i, val) {
    if (!/^\d?$/.test(val)) return;
    const next = [...otp];
    next[i] = val;
    setOtp(next);
    if (val && i < 3) otpRefs.current[i + 1]?.focus();
  }

  function handleOtpKeyDown(i, e) {
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  }

  function handleVerify(e) {
    e.preventDefault();
    if (otp.join("").length !== 4) return setError("Enter the 4-digit code");
    setError("");
    setScreen("home");
  }

  function handleBookingSubmit(e) {
    e.preventDefault();
    if (!pickup.trim() || !drop.trim()) return setBookingError("Enter both pickup and drop locations");
    setBookingError("");
    setScreen("estimate");
  }

  function confirmBooking() {
    const trip = buildTrip({ pickup, drop, vehicle, tripType, instructions });
    setActiveTrip(trip);
    setScreen("tracking");
  }

  function advanceTrip() {
    setActiveTrip((t) => {
      if (!t) return t;
      if (t.status === "assigned") return { ...t, status: "in_transit" };
      if (t.currentSegment < t.segments) return { ...t, currentSegment: t.currentSegment + 1 };
      const delivered = { ...t, status: "delivered" };
      setTripHistory((h) => [delivered, ...h]);
      return delivered;
    });
  }

  function startNewBooking() {
    setPickup(""); setDrop(""); setVehicle("mini"); setTripType("single"); setInstructions("");
    setScreen("booking");
  }

  const showNav = ["home", "tracking", "history"].includes(screen);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {screen === "login" && (
          <LoginScreen phone={phone} setPhone={setPhone} error={error} onSubmit={handleSendOtp} />
        )}

        {screen === "otp" && (
          <OtpScreen phone={phone} otp={otp} otpRefs={otpRefs} error={error}
            onChange={handleOtpChange} onKeyDown={handleOtpKeyDown} onSubmit={handleVerify}
            onEditNumber={() => setScreen("login")} />
        )}

        {screen === "home" && (
          <HomeScreen activeTrip={activeTrip} onNewBooking={startNewBooking}
            onViewActive={() => setScreen("tracking")} />
        )}

        {screen === "booking" && (
          <BookingScreen pickup={pickup} setPickup={setPickup} drop={drop} setDrop={setDrop}
            vehicle={vehicle} setVehicle={setVehicle} tripType={tripType} setTripType={setTripType}
            instructions={instructions} setInstructions={setInstructions} error={bookingError}
            onSubmit={handleBookingSubmit} onBack={() => setScreen("home")} />
        )}

        {screen === "estimate" && (
          <EstimateScreen pickup={pickup} drop={drop} vehicle={vehicle} tripType={tripType}
            onConfirm={confirmBooking} onBack={() => setScreen("booking")} />
        )}

        {screen === "tracking" && (
          <TrackingScreen trip={activeTrip} onAdvance={advanceTrip}
            onNewBooking={startNewBooking} />
        )}

        {screen === "history" && <HistoryScreen trips={tripHistory} />}

        {showNav && <BottomNav screen={screen} setScreen={setScreen} hasActiveTrip={!!activeTrip && activeTrip.status !== "delivered"} />}
      </div>
    </div>
  );
}

// ───────────────────────── Login / OTP ─────────────────────────

function LoginScreen({ phone, setPhone, error, onSubmit }) {
  return (
    <div className="bg-slate-800 rounded-lg p-8 shadow-2xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="bg-amber-400 rounded-md p-2">
          <Truck className="w-6 h-6 text-slate-900" strokeWidth={2.5} />
        </div>
        <span className="text-slate-400 text-sm tracking-wide">Relay Freight</span>
      </div>
      <h1 className="text-4xl text-white leading-none mt-4 mb-2" style={headlineFont}>
        Book a truck.<br />Any distance.
      </h1>
      <p className="text-slate-400 text-sm mb-8">Enter your mobile number to get started.</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="text-slate-300 text-sm font-medium block mb-2">Mobile number</label>
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-md px-3 focus-within:border-amber-400 transition-colors">
            <Phone className="w-4 h-4 text-slate-500 mr-2" />
            <span className="text-slate-400 text-sm mr-2">+91</span>
            <input type="tel" inputMode="numeric" maxLength={10} value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210"
              className="bg-transparent text-white placeholder-slate-600 py-3 flex-1 outline-none text-sm tracking-wide" />
          </div>
          {error && <p className="text-orange-400 text-xs mt-2">{error}</p>}
        </div>
        <button type="submit" className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md flex items-center justify-center gap-2 transition-colors">
          Send OTP <ArrowRight className="w-4 h-4" />
        </button>
      </form>
      <p className="text-slate-500 text-xs mt-6 text-center">
        By continuing, you agree to Relay Freight's Terms and Privacy Policy.
      </p>
    </div>
  );
}

function OtpScreen({ phone, otp, otpRefs, error, onChange, onKeyDown, onSubmit, onEditNumber }) {
  return (
    <div className="bg-slate-800 rounded-lg p-8 shadow-2xl">
      <div className="bg-slate-700/60 rounded-md p-2 w-fit mb-6">
        <ShieldCheck className="w-6 h-6 text-amber-400" />
      </div>
      <h1 className="text-3xl text-white leading-none mb-2" style={headlineFont}>Verify your number</h1>
      <p className="text-slate-400 text-sm mb-8">
        Code sent to <span className="text-slate-200">+91 {phone}</span>{" "}
        <button type="button" onClick={onEditNumber} className="text-amber-400 hover:text-amber-300 underline underline-offset-2">Edit</button>
      </p>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="flex gap-3 justify-between">
          {otp.map((digit, i) => (
            <input key={i} ref={(el) => (otpRefs.current[i] = el)} type="text" inputMode="numeric" maxLength={1}
              value={digit} onChange={(e) => onChange(i, e.target.value)} onKeyDown={(e) => onKeyDown(i, e)}
              className="w-14 h-14 text-center text-xl text-white bg-slate-900 border border-slate-700 rounded-md outline-none focus:border-amber-400 transition-colors" />
          ))}
        </div>
        {error && <p className="text-orange-400 text-xs">{error}</p>}
        <button type="submit" className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md transition-colors">
          Verify &amp; continue
        </button>
      </form>
    </div>
  );
}

// ───────────────────────── Home ─────────────────────────

function HomeScreen({ activeTrip, onNewBooking, onViewActive }) {
  const hasActive = activeTrip && activeTrip.status !== "delivered";
  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-1">
          <div className="bg-amber-400 rounded-md p-2">
            <Truck className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
          </div>
          <span className="text-slate-400 text-sm tracking-wide">Relay Freight</span>
        </div>
        <h1 className="text-3xl text-white leading-none mt-3 mb-4" style={headlineFont}>
          Where's your cargo headed?
        </h1>
        <button onClick={onNewBooking} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md flex items-center justify-center gap-2 transition-colors">
          New booking <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {hasActive && (
        <button onClick={onViewActive} className="w-full text-left bg-slate-800 rounded-lg p-5 shadow-2xl border border-amber-400/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">Active trip · {activeTrip.id}</span>
            <Navigation className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-white text-sm">{activeTrip.pickup} → {activeTrip.drop}</p>
          <p className="text-slate-500 text-xs mt-1">Tap to view live tracking</p>
        </button>
      )}
    </div>
  );
}

// ───────────────────────── Booking ─────────────────────────

function BookingScreen({ pickup, setPickup, drop, setDrop, vehicle, setVehicle, tripType, setTripType, instructions, setInstructions, error, onSubmit, onBack }) {
  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
      <button type="button" onClick={onBack} className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-3xl text-white leading-none mb-6" style={headlineFont}>New booking</h1>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-md px-3 focus-within:border-amber-400 transition-colors">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-3 shrink-0" />
            <input type="text" value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Pickup location"
              className="bg-transparent text-white placeholder-slate-600 py-3 flex-1 outline-none text-sm" />
          </div>
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-md px-3 focus-within:border-amber-400 transition-colors">
            <MapPin className="w-3.5 h-3.5 text-orange-400 mr-3 shrink-0" />
            <input type="text" value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="Drop location"
              className="bg-transparent text-white placeholder-slate-600 py-3 flex-1 outline-none text-sm" />
          </div>
          {error && <p className="text-orange-400 text-xs">{error}</p>}
        </div>

        <div>
          <label className="text-slate-300 text-sm font-medium block mb-3">Vehicle type</label>
          <div className="grid grid-cols-2 gap-3">
            {VEHICLE_TYPES.map(({ id, label, capacity, icon: Icon }) => {
              const selected = vehicle === id;
              return (
                <button key={id} type="button" onClick={() => setVehicle(id)}
                  className={`rounded-md p-3 text-left border transition-colors ${selected ? "bg-amber-400/10 border-amber-400" : "bg-slate-900 border-slate-700 hover:border-slate-600"}`}>
                  <Icon className={`w-5 h-5 mb-2 ${selected ? "text-amber-400" : "text-slate-400"}`} />
                  <div className={`text-sm font-medium ${selected ? "text-white" : "text-slate-300"}`}>{label}</div>
                  <div className="text-xs text-slate-500">{capacity}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-slate-300 text-sm font-medium block mb-3">Trip type</label>
          <div className="flex bg-slate-900 border border-slate-700 rounded-md p-1">
            <button type="button" onClick={() => setTripType("single")}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${tripType === "single" ? "bg-amber-400 text-slate-900" : "text-slate-400"}`}>
              Single driver
            </button>
            <button type="button" onClick={() => setTripType("relay")}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${tripType === "relay" ? "bg-amber-400 text-slate-900" : "text-slate-400"}`}>
              Relay (multi-driver)
            </button>
          </div>
          {tripType === "relay" && (
            <p className="text-xs text-slate-500 mt-2">
              Your cargo hands off between drivers at relay hubs along the route — faster for long-haul trips, with a fresh driver each leg.
            </p>
          )}
        </div>

        <div>
          <label className="text-slate-300 text-sm font-medium block mb-2">
            Special instructions <span className="text-slate-600">(optional)</span>
          </label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="Fragile, temperature-sensitive, loading assistance needed…" rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white placeholder-slate-600 outline-none focus:border-amber-400 text-sm resize-none transition-colors" />
        </div>

        <button type="submit" className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md flex items-center justify-center gap-2 transition-colors">
          See fare estimate <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

// ───────────────────────── Fare Estimate ─────────────────────────

function EstimateScreen({ pickup, drop, vehicle, tripType, onConfirm, onBack }) {
  const v = VEHICLE_TYPES.find((x) => x.id === vehicle);
  const distance = estimateDistanceKm(pickup, drop);
  const fare = BASE_FARE + distance * v.ratePerKm;
  const segments = tripType === "relay" ? Math.max(2, Math.ceil(distance / 250)) : 1;

  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
      <button type="button" onClick={onBack} className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-3xl text-white leading-none mb-6" style={headlineFont}>Fare estimate</h1>

      <div className="bg-slate-900 rounded-md p-4 mb-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
          <p className="text-sm text-slate-200">{pickup}</p>
        </div>
        <div className="flex items-start gap-3">
          <MapPin className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-sm text-slate-200">{drop}</p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <Row label="Vehicle" value={v.label} />
        <Row label="Estimated distance" value={`${distance} km`} />
        <Row label="Trip type" value={tripType === "relay" ? `Relay · ${segments} segments` : "Single driver"} />
      </div>

      {tripType === "relay" && (
        <div className="bg-amber-400/10 border border-amber-400/30 rounded-md p-3 mb-4">
          <p className="text-xs text-amber-300">
            This trip will pass through {segments - 1} relay {segments - 1 === 1 ? "hub" : "hubs"}, with a new driver taking over at each one.
          </p>
        </div>
      )}

      <div className="border-t border-slate-700 pt-4 mb-6">
        <div className="flex items-baseline justify-between">
          <span className="text-slate-400 text-sm">Total fare</span>
          <span className="text-3xl text-white" style={headlineFont}>₹{fare.toLocaleString("en-IN")}</span>
        </div>
        <p className="text-slate-600 text-xs mt-1">Base fare ₹{BASE_FARE} + ₹{v.ratePerKm}/km</p>
      </div>

      <button onClick={onConfirm} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md flex items-center justify-center gap-2 transition-colors">
        Confirm booking <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

// ───────────────────────── Tracking ─────────────────────────

function TrackingScreen({ trip, onAdvance, onNewBooking }) {
  if (!trip) {
    return (
      <div className="bg-slate-800 rounded-lg p-8 shadow-2xl text-center pb-20">
        <p className="text-slate-400 text-sm mb-4">No active trip yet.</p>
        <button onClick={onNewBooking} className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-2.5 px-5 rounded-md text-sm transition-colors">
          Book a truck
        </button>
      </div>
    );
  }

  const delivered = trip.status === "delivered";
  const v = VEHICLE_TYPES.find((x) => x.id === trip.vehicle);
  const currentDriver = trip.drivers[Math.min(trip.currentSegment - 1, trip.drivers.length - 1)];

  const stops = ["Pickup", ...trip.hubs, "Drop"];

  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Trip {trip.id}</span>
          <StatusPill status={trip.status} />
        </div>

        <h1 className="text-2xl text-white leading-none mb-1" style={headlineFont}>
          {trip.pickup} → {trip.drop}
        </h1>
        <p className="text-slate-500 text-xs mb-5">{v.label} · {trip.distance} km · ₹{trip.fare.toLocaleString("en-IN")}</p>

        {/* Route/segment timeline — a real sequence of relay handovers */}
        <div className="space-y-0 mb-5">
          {stops.map((stop, i) => {
            const stopIndex = i + 1;
            const done = stopIndex < trip.currentSegment || (stopIndex === trip.currentSegment && trip.status !== "assigned" && stopIndex !== stops.length) || delivered;
            const isCurrent = !delivered && stopIndex === trip.currentSegment;
            return (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {done ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : isCurrent ? (
                    <Circle className="w-5 h-5 text-amber-400 fill-amber-400/20" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-700" />
                  )}
                  {i < stops.length - 1 && (
                    <div className={`w-px flex-1 min-h-[28px] ${done ? "bg-emerald-400/40" : "bg-slate-700"}`} />
                  )}
                </div>
                <div className="pb-6">
                  <p className={`text-sm ${isCurrent ? "text-white font-medium" : done ? "text-slate-300" : "text-slate-600"}`}>
                    {stop}
                  </p>
                  {isCurrent && !delivered && (
                    <p className="text-xs text-amber-400 mt-0.5">Driver: {currentDriver}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!delivered && (
          <button onClick={onAdvance} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-2.5 rounded-md text-sm transition-colors">
            {trip.status === "assigned" ? "Simulate: driver departs" : "Simulate: reach next stop"}
          </button>
        )}
        {delivered && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3 text-center">
            <p className="text-emerald-400 text-sm font-medium">Delivered</p>
            <p className="text-slate-500 text-xs mt-1">Proof of delivery captured with receiver OTP.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    assigned: { label: "Driver assigned", cls: "bg-slate-700 text-slate-300" },
    in_transit: { label: "In transit", cls: "bg-amber-400/20 text-amber-400" },
    delivered: { label: "Delivered", cls: "bg-emerald-500/20 text-emerald-400" },
  };
  const s = map[status];
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>;
}

// ───────────────────────── History ─────────────────────────

function HistoryScreen({ trips }) {
  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <h1 className="text-3xl text-white leading-none mb-5" style={headlineFont}>Trip history</h1>

        {trips.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-8 h-8 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No completed trips yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {trips.map((t) => {
              const v = VEHICLE_TYPES.find((x) => x.id === t.vehicle);
              return (
                <div key={t.id} className="bg-slate-900 rounded-md p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500">{t.id}</span>
                    <StatusPill status={t.status} />
                  </div>
                  <p className="text-sm text-slate-200">{t.pickup} → {t.drop}</p>
                  <p className="text-xs text-slate-500 mt-1">{v.label} · {t.distance} km · ₹{t.fare.toLocaleString("en-IN")}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Bottom Nav ─────────────────────────

function BottomNav({ screen, setScreen, hasActiveTrip }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "tracking", label: "Track", icon: Navigation, disabled: !hasActiveTrip },
    { id: "history", label: "History", icon: History },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700">
      <div className="max-w-sm mx-auto flex">
        {items.map(({ id, label, icon: Icon, disabled }) => {
          const active = screen === id;
          return (
            <button key={id} disabled={disabled} onClick={() => setScreen(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
                active ? "text-amber-400" : disabled ? "text-slate-700" : "text-slate-500 hover:text-slate-300"
              }`}>
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
