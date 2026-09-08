import React, { useState, useRef } from "react";
import {
  Truck, Phone, ArrowRight, ShieldCheck, MapPin, Wallet, Home, User,
  AlertTriangle, CheckCircle2, Circle, Fuel, Camera, KeyRound, Package,
} from "lucide-react";

const headlineFont = { fontFamily: "'Barlow Condensed', sans-serif" };

// Demo trip request the driver receives when they go online.
// In the real relay platform, this comes from the ops dispatch system —
// note the driver only ever sees THEIR assigned segment, not the whole route.
const DEMO_REQUEST = {
  id: "RF4821",
  segmentLabel: "Segment 2 of 3",
  from: "Ludhiana Relay Hub",
  to: "Ambala Relay Hub",
  distanceKm: 110,
  cargo: "Textile bales, 3.2 tons",
  earnings: 1450,
  window: "Depart by 2:30 PM",
};

const STATUS_STEPS = ["Reached pickup", "Loading started", "Departed", "Reached hub"];

export default function DriverApp() {
  const [screen, setScreen] = useState("login");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const otpRefs = useRef([]);

  const [online, setOnline] = useState(false);
  const [request, setRequest] = useState(null);
  const [trip, setTrip] = useState(null); // accepted trip in progress
  const [stepIndex, setStepIndex] = useState(0); // index into STATUS_STEPS

  const [wallet, setWallet] = useState(8250);
  const [transactions, setTransactions] = useState([
    { id: "RF4790", amount: 1200, date: "Yesterday" },
    { id: "RF4765", amount: 980, date: "2 days ago" },
  ]);

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

  function toggleOnline() {
    setOnline((was) => {
      const next = !was;
      if (next) setRequest(DEMO_REQUEST); // simulate dispatch sending a request
      else setRequest(null);
      return next;
    });
  }

  function acceptRequest() {
    setTrip({ ...request });
    setRequest(null);
    setStepIndex(0);
    setScreen("trip");
  }

  function rejectRequest() {
    setRequest(null);
  }

  function advanceStatus() {
    if (stepIndex < STATUS_STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      setScreen("handover");
    }
  }

  function completeHandover() {
    setWallet((w) => w + trip.earnings);
    setTransactions((t) => [{ id: trip.id, amount: trip.earnings, date: "Just now" }, ...t]);
    setTrip(null);
    setStepIndex(0);
    setScreen("home");
  }

  const showNav = ["home", "earnings", "safety"].includes(screen);

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
          <HomeScreen online={online} onToggleOnline={toggleOnline} request={request}
            onAccept={acceptRequest} onReject={rejectRequest} />
        )}

        {screen === "trip" && trip && (
          <TripScreen trip={trip} stepIndex={stepIndex} onAdvance={advanceStatus} />
        )}

        {screen === "handover" && trip && (
          <HandoverScreen trip={trip} onComplete={completeHandover} />
        )}

        {screen === "earnings" && <EarningsScreen wallet={wallet} transactions={transactions} />}

        {screen === "safety" && <SafetyScreen />}

        {showNav && <BottomNav screen={screen} setScreen={setScreen} />}
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
        <span className="text-slate-400 text-sm tracking-wide">Relay Freight · Driver</span>
      </div>
      <h1 className="text-4xl text-white leading-none mt-4 mb-2" style={headlineFont}>
        Drive.<br />Earn on your terms.
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

// ───────────────────────── Home (online toggle + requests) ─────────────────────────

function HomeScreen({ online, onToggleOnline, request, onAccept, onReject }) {
  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Status</p>
            <p className="text-xl text-white" style={headlineFont}>
              {online ? "Online — receiving trips" : "Offline"}
            </p>
          </div>
          <button
            onClick={onToggleOnline}
            className={`w-14 h-8 rounded-full relative transition-colors ${online ? "bg-amber-400" : "bg-slate-700"}`}
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-slate-900 transition-transform ${online ? "translate-x-7" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {online && !request && (
        <div className="bg-slate-800 rounded-lg p-6 shadow-2xl text-center">
          <div className="w-2 h-2 rounded-full bg-amber-400 mx-auto mb-3 animate-pulse" />
          <p className="text-slate-400 text-sm">Waiting for a trip request…</p>
        </div>
      )}

      {request && (
        <div className="bg-slate-800 rounded-lg p-6 shadow-2xl border border-amber-400/40">
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">{request.segmentLabel}</span>
          <h2 className="text-2xl text-white leading-none mt-1 mb-4" style={headlineFont}>
            New trip request
          </h2>

          <div className="space-y-3 mb-4">
            <div className="flex items-start gap-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
              <p className="text-sm text-slate-200">{request.from}</p>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-sm text-slate-200">{request.to}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
            <Info label="Distance" value={`${request.distanceKm} km`} />
            <Info label="Earnings" value={`₹${request.earnings}`} />
            <Info label="Cargo" value={request.cargo} />
            <Info label="Depart" value={request.window} />
          </div>

          <div className="flex gap-3">
            <button onClick={onReject} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2.5 rounded-md text-sm transition-colors">
              Decline
            </button>
            <button onClick={onAccept} className="flex-1 bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-2.5 rounded-md text-sm transition-colors">
              Accept
            </button>
          </div>
        </div>
      )}

      {!online && (
        <div className="bg-slate-800 rounded-lg p-6 shadow-2xl text-center">
          <p className="text-slate-500 text-sm">Go online to start receiving trip requests.</p>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="bg-slate-900 rounded-md p-2.5">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-200 text-sm mt-0.5">{value}</p>
    </div>
  );
}

// ───────────────────────── Active Trip ─────────────────────────

function TripScreen({ trip, stepIndex, onAdvance }) {
  const isLastStep = stepIndex === STATUS_STEPS.length - 1;
  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{trip.segmentLabel}</span>
      <h1 className="text-2xl text-white leading-none mt-1 mb-1" style={headlineFont}>
        {trip.from} → {trip.to}
      </h1>
      <p className="text-slate-500 text-xs mb-6">{trip.cargo} · {trip.distanceKm} km</p>

      <div className="space-y-0 mb-6">
        {STATUS_STEPS.map((step, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <div key={step} className="flex gap-3">
              <div className="flex flex-col items-center">
                {done ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : (
                  <Circle className={`w-5 h-5 ${current ? "text-amber-400 fill-amber-400/20" : "text-slate-700"}`} />
                )}
                {i < STATUS_STEPS.length - 1 && <div className={`w-px flex-1 min-h-[24px] ${done ? "bg-emerald-400/40" : "bg-slate-700"}`} />}
              </div>
              <p className={`text-sm pb-5 ${current ? "text-white font-medium" : done ? "text-slate-300" : "text-slate-600"}`}>
                {step}
              </p>
            </div>
          );
        })}
      </div>

      <button onClick={onAdvance} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md transition-colors">
        {isLastStep ? "Start handover" : `Mark: ${STATUS_STEPS[stepIndex + 1]}`}
      </button>
    </div>
  );
}

// ───────────────────────── Handover (relay-specific) ─────────────────────────

function HandoverScreen({ trip, onComplete }) {
  const [checklist, setChecklist] = useState({
    vehicle: false, fuel: false, seal: false, damage: false,
  });
  const [photoTaken, setPhotoTaken] = useState(false);
  const [otpInput, setOtpInput] = useState(["", "", "", ""]);
  const otpRefs = useRef([]);
  const [error, setError] = useState("");

  const allChecked = Object.values(checklist).every(Boolean);
  const otpComplete = otpInput.join("").length === 4;

  function toggle(key) {
    setChecklist((c) => ({ ...c, [key]: !c[key] }));
  }

  function handleOtpChange(i, val) {
    if (!/^\d?$/.test(val)) return;
    const next = [...otpInput];
    next[i] = val;
    setOtpInput(next);
    if (val && i < 3) otpRefs.current[i + 1]?.focus();
  }

  function handleSignOff() {
    if (!allChecked) return setError("Complete the pre-handover checklist first");
    if (!photoTaken) return setError("Capture the handover photo");
    if (!otpComplete) return setError("Enter the 4-digit handshake code from the next driver");
    setError("");
    onComplete();
  }

  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
      <h1 className="text-2xl text-white leading-none mb-1" style={headlineFont}>Handover at {trip.to}</h1>
      <p className="text-slate-500 text-xs mb-6">Confirm with the next driver before you sign off.</p>

      <p className="text-slate-300 text-sm font-medium mb-3">Pre-handover checklist</p>
      <div className="space-y-2 mb-6">
        <ChecklistItem icon={Truck} label="Vehicle condition checked" checked={checklist.vehicle} onToggle={() => toggle("vehicle")} />
        <ChecklistItem icon={Fuel} label="Fuel level noted" checked={checklist.fuel} onToggle={() => toggle("fuel")} />
        <ChecklistItem icon={Package} label="Seal number verified" checked={checklist.seal} onToggle={() => toggle("seal")} />
        <ChecklistItem icon={AlertTriangle} label="No visible damage" checked={checklist.damage} onToggle={() => toggle("damage")} />
      </div>

      <button
        onClick={() => setPhotoTaken(true)}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-md text-sm font-medium mb-6 border transition-colors ${
          photoTaken ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600"
        }`}
      >
        <Camera className="w-4 h-4" />
        {photoTaken ? "Photo captured" : "Capture cargo & seal photo"}
      </button>

      <p className="text-slate-300 text-sm font-medium mb-3 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-amber-400" /> Handshake code from next driver
      </p>
      <div className="flex gap-3 justify-between mb-2">
        {otpInput.map((digit, i) => (
          <input key={i} ref={(el) => (otpRefs.current[i] = el)} type="text" inputMode="numeric" maxLength={1}
            value={digit} onChange={(e) => handleOtpChange(i, e.target.value)}
            className="w-14 h-14 text-center text-xl text-white bg-slate-900 border border-slate-700 rounded-md outline-none focus:border-amber-400 transition-colors" />
        ))}
      </div>
      <p className="text-slate-600 text-xs mb-6">Ask the next driver for the code shown on their app.</p>

      {error && <p className="text-orange-400 text-xs mb-4">{error}</p>}

      <button onClick={handleSignOff} className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-3 rounded-md transition-colors">
        Sign off &amp; complete handover
      </button>
    </div>
  );
}

function ChecklistItem({ icon: Icon, label, checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 p-3 rounded-md border text-left transition-colors ${
        checked ? "bg-emerald-500/10 border-emerald-500/40" : "bg-slate-900 border-slate-700 hover:border-slate-600"
      }`}
    >
      {checked ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <Circle className="w-5 h-5 text-slate-600 shrink-0" />}
      <Icon className="w-4 h-4 text-slate-500 shrink-0" />
      <span className={`text-sm ${checked ? "text-emerald-300" : "text-slate-300"}`}>{label}</span>
    </button>
  );
}

// ───────────────────────── Earnings ─────────────────────────

function EarningsScreen({ wallet, transactions }) {
  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <Wallet className="w-4 h-4 text-amber-400" />
          <p className="text-slate-500 text-xs uppercase tracking-wide">Wallet balance</p>
        </div>
        <p className="text-4xl text-white" style={headlineFont}>₹{wallet.toLocaleString("en-IN")}</p>
        <button className="mt-4 w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold py-2.5 rounded-md text-sm transition-colors">
          Request payout
        </button>
      </div>

      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <p className="text-slate-300 text-sm font-medium mb-3">Recent trips</p>
        <div className="space-y-2">
          {transactions.map((t, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <div>
                <p className="text-slate-200">{t.id}</p>
                <p className="text-slate-600 text-xs">{t.date}</p>
              </div>
              <p className="text-emerald-400 font-medium">+₹{t.amount}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Safety ─────────────────────────

function SafetyScreen() {
  const [sosSent, setSosSent] = useState(false);
  return (
    <div className="space-y-4 pb-20">
      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl text-center">
        <p className="text-slate-500 text-xs uppercase tracking-wide mb-4">Safety</p>
        <button
          onClick={() => setSosSent(true)}
          className={`w-32 h-32 rounded-full mx-auto flex flex-col items-center justify-center gap-1 font-bold transition-colors ${
            sosSent ? "bg-emerald-500 text-slate-900" : "bg-orange-600 hover:bg-orange-500 text-white"
          }`}
        >
          <AlertTriangle className="w-7 h-7" />
          {sosSent ? "Sent" : "SOS"}
        </button>
        <p className="text-slate-500 text-xs mt-4">
          {sosSent ? "Your location was shared with admin and your emergency contact." : "Press and hold to share your live location with admin and your emergency contact."}
        </p>
      </div>

      <div className="bg-slate-800 rounded-lg p-6 shadow-2xl">
        <p className="text-slate-300 text-sm font-medium mb-3">Report an incident</p>
        <div className="grid grid-cols-2 gap-2">
          {["Accident", "Breakdown", "Theft", "Harassment"].map((label) => (
            <button key={label} className="bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-sm py-2.5 rounded-md transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Bottom Nav ─────────────────────────

function BottomNav({ screen, setScreen }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "earnings", label: "Earnings", icon: Wallet },
    { id: "safety", label: "Safety", icon: AlertTriangle },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700">
      <div className="max-w-sm mx-auto flex">
        {items.map(({ id, label, icon: Icon }) => {
          const active = screen === id;
          return (
            <button key={id} onClick={() => setScreen(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${active ? "text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
