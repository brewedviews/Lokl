// Lokl customer-location toolkit.
//
// What this owns:
// - Asking the user for browser geolocation (called only AFTER user clicks the
//   custom "Share Location" CTA — we do NOT auto-prompt on page load).
// - Persisting the result + permission state in localStorage so the modal
//   doesn't reappear every visit.
// - A point-in-polygon Bhilai service geofence covering Bhilai + Durg + Jamul
//   + Risali + Utai + Charoda so urban-agglomeration edge addresses are
//   correctly classified as in-service.
// - Haversine distance for sorting "nearby stores".
//
// All other components listen to the `lokl:location` window event to react.

const LS_KEY = "lokl_loc_v1";  // {state, lat, lng, in_service, ts}

// Coarse polygon (lat, lng pairs) wrapping the Bhilai urban agglomeration —
// roughly: NW above Durg → NE above Charoda → SE below Jamul → SW below Durg.
// Refined v1; we can swap to a precise geojson polygon later without touching
// any callsites.
const BHILAI_POLYGON = [
  [21.3700, 81.1700],
  [21.3700, 81.5200],
  [21.0700, 81.5200],
  [21.0700, 81.1700],
];

function pointInPolygon(lat, lng, poly) {
  // Ray-casting algorithm
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInBhilaiServiceArea(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return pointInPolygon(lat, lng, BHILAI_POLYGON);
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number")) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function readStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch { return null; }
}

function write(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify({ ...obj, ts: Date.now() }));
  try { window.dispatchEvent(new CustomEvent("lokl:location", { detail: obj })); } catch {}
}

// state values:
//  - "unknown"   never asked
//  - "granted"   user shared coordinates
//  - "denied"    user blocked the permission
//  - "skipped"   user dismissed our custom modal (treat similar to denied but soft)
export function getPermissionState() {
  const s = readStored();
  return s?.state || "unknown";
}

export function getCoords() {
  const s = readStored();
  if (s?.state === "granted" && typeof s.lat === "number") return { lat: s.lat, lng: s.lng };
  return null;
}

export function isUserInService() {
  const s = readStored();
  return !!(s && s.state === "granted" && s.in_service === true);
}

export function markSkipped() { write({ state: "skipped" }); }
export function markDenied()  { write({ state: "denied" }); }

export function requestBrowserLocation() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      markDenied();
      return resolve({ ok: false, reason: "unsupported" });
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        const in_service = isInBhilaiServiceArea(lat, lng);
        write({ state: "granted", lat, lng, in_service });
        resolve({ ok: true, lat, lng, in_service });
      },
      (err) => {
        markDenied();
        resolve({ ok: false, reason: err?.message || "denied" });
      },
      { timeout: 10000, maximumAge: 600000, enableHighAccuracy: false }
    );
  });
}

// Soft re-prompt: the browser doesn't have a "soft" reset; we just clear the
// state so our custom modal can show again the next time the gate mounts.
export function resetLocation() {
  localStorage.removeItem(LS_KEY);
  try { window.dispatchEvent(new CustomEvent("lokl:location", { detail: { state: "unknown" } })); } catch {}
}

// Hook helper — components can subscribe to changes for re-render
export function onLocationChange(handler) {
  const fn = () => handler(readStored());
  window.addEventListener("lokl:location", fn);
  return () => window.removeEventListener("lokl:location", fn);
}
