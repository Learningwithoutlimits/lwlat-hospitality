// Bookings API for the hospitality form and the catering admin page.
//
//   POST   /api/bookings        open to anyone, creates a booking request. With
//                                "staffEntry": true, the Catering Team adds a
//                                booking by hand, with looser rules.
//   GET    /api/bookings        Catering Team, lists every booking
//   PATCH  /api/bookings/:id    Catering Team, updates status and catering notes
//   POST   /api/bookings/:id/confirm
//                               Catering Team, confirms the order and emails the booker
//   DELETE /api/bookings/:id    Catering Team, deletes a booking
//
// References are the site's code, the booking date as ddmmyy, and a number
// counting up from 001 for that site and date, e.g. swhs271026001.
//
// Catering Team requests carry the person's Microsoft sign-in token as
// "Authorization: Bearer <token>". The Catering Team are the people IT has
// given the Catering.Admin app role in Entra. The booking form needs no sign-in.

import { getStore } from "@netlify/blobs";
import { notifyNewBooking, sendBookingConfirmation } from "../lib/notify.mjs";
import { signedInUser } from "../lib/auth.mjs";

export const config = {
  path: ["/api/bookings", "/api/bookings/:id", "/api/bookings/:id/confirm"],
};

const SITES = ["Babington", "Heatherbrook", "Lancaster", "South Wigston", "Woodstock", "Central Team"];
const TYPES = ["hospitality", "packed-lunch"];
const STATUSES = ["New", "Info requested", "Confirmed", "Declined", "Cancelled", "Completed"];

// Short codes for booking references. Change these if a school prefers another.
const SITE_CODES = {
  "Babington": "ba",
  "Heatherbrook": "hpa",
  "Lancaster": "la",
  "South Wigston": "swhs",
  "Woodstock": "wpa",
  "Central Team": "ct",
};
const MAX_BODY_BYTES = 20000;
const BESPOKE = "Bespoke, themed or other";

const store = () => getStore({ name: "bookings", consistency: "strong" });

export default async (req, context) => {
  const id = context.params?.id;
  try {
    if (req.method === "POST" && !id) return await createBooking(req);
    const user = await signedInUser(req);
    if (!user) return json({ error: "Please sign in with your LWLAT Microsoft account." }, 401);
    if (!user.isAdmin) return json({ error: "Your account does not have access to the Catering Team page." }, 403);
    if (req.method === "GET" && !id) return await listBookings();
    if (req.method === "POST" && id && new URL(req.url).pathname.endsWith("/confirm")) return await confirmBooking(id, user);
    if (req.method === "PATCH" && id) return await updateBooking(id, req, user);
    if (req.method === "DELETE" && id) return await deleteBooking(id);
    return json({ error: "Not found." }, 404);
  } catch (err) {
    if (err instanceof BadRequest) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

// ---------- handlers ----------

async function createBooking(req) {
  const body = await readJson(req);
  const staff = body.staffEntry === true;
  let user = null;
  if (staff) {
    user = await signedInUser(req);
    if (!user) return json({ error: "Please sign in with your LWLAT Microsoft account." }, 401);
    if (!user.isAdmin) {
      return json({ error: "Your account does not have access to add bookings for the Catering Team." }, 403);
    }
  }

  // Honeypot field, hidden from people. Bots tend to fill it in.
  if (body.website) return json({ ok: true, reference: "lwlat000000001" }, 201);

  const booking = validateBooking(body, staff);
  const now = new Date();
  if (staff) {
    booking.status = body.status === undefined ? "Confirmed" : oneOf(body.status, STATUSES, "a status");
    booking.cateringNotes = text(body.cateringNotes, 2000);
    booking.addedByStaff = true;
  } else {
    booking.status = "New";
    booking.cateringNotes = "";
  }
  if (user) booking.submittedBy = { name: user.name, email: user.email };
  booking.createdAt = now.toISOString();
  booking.updatedAt = booking.createdAt;

  await saveWithNewReference(booking);

  // Tell the site's catering manager. Bookings the team adds themselves need
  // no alert. The booking is already saved, so a failed email cannot lose it,
  // and the outcome is kept on the booking for the admin page to show.
  if (!staff) {
    const alert = await notifyNewBooking(booking);
    if (!alert.sent) console.error("Booking alert not sent", booking.id, alert.reason);
    booking.alert = { ...alert, at: new Date().toISOString() };
    await store().setJSON(booking.id, booking);
  }

  return json({ ok: true, reference: booking.id }, 201);
}

async function listBookings() {
  const s = store();
  const { blobs } = await s.list();
  const bookings = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return json({ bookings: bookings.filter(Boolean) });
}

async function updateBooking(id, req, user) {
  const s = store();
  const booking = await s.get(id, { type: "json" });
  if (!booking) return json({ error: "Booking not found." }, 404);

  const body = await readJson(req);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new BadRequest("Unknown status.");
    booking.status = body.status;
  }
  if (body.cateringNotes !== undefined) {
    booking.cateringNotes = text(body.cateringNotes, 2000);
  }
  booking.updatedAt = new Date().toISOString();
  booking.updatedBy = user.name || user.email;

  await s.setJSON(id, booking);
  return json({ ok: true, booking });
}

// Marks the booking Confirmed and emails the booker. The status changes even
// if the email cannot be sent, and the outcome is kept for the admin page.
async function confirmBooking(id, user) {
  const s = store();
  const booking = await s.get(id, { type: "json" });
  if (!booking) return json({ error: "Booking not found." }, 404);

  booking.status = "Confirmed";
  booking.updatedAt = new Date().toISOString();
  booking.updatedBy = user.name || user.email;
  const result = await sendBookingConfirmation(booking, user);
  if (!result.sent) console.error("Confirmation email not sent", id, result.reason);
  booking.confirmation = { ...result, at: booking.updatedAt, by: booking.updatedBy };

  await s.setJSON(id, booking);
  return json({ ok: true, booking });
}

async function deleteBooking(id) {
  await store().delete(id);
  return json({ ok: true });
}

// ---------- validation ----------

class BadRequest extends Error {}

// Bookings the Catering Team adds themselves, such as phone orders or past
// orders, may be missing contact details, so those fields become optional.
function validateBooking(b, staff = false) {
  const ask = staff ? (value, label, max) => text(value, max) : required;
  const out = {
    site: oneOf(b.site, SITES, "which site the booking is for"),
    type: oneOf(b.type, TYPES, "hospitality or packed lunches"),
    name: required(b.name, "your name", 100),
    email: staff && !text(b.email, 200) ? "" : email(b.email),
    phone: ask(b.phone, "a contact telephone number", 30),
    department: ask(b.department, "your department, team or organisation", 150),
    date: isoDate(b.date),
    time: ask(b.time, "a delivery or service time", 50),
    people: wholeNumber(b.people, "the number of people", 1, 2000),
    eventName: required(b.eventName, "an event or meeting name", 150),
    costCentre: ask(b.costCentre, "a cost centre or budget code", 50),
    dietary: oneOf(b.dietary, ["Yes", "No"], "whether there are dietary requirements"),
    dietaryDetails: text(b.dietaryDetails, 2000),
    notes: text(b.notes, 2000),
  };

  if (out.dietary === "Yes" && !out.dietaryDetails) {
    throw new BadRequest("Please give details of the dietary requirements or allergies.");
  }

  if (out.type === "hospitality") {
    out.venue = ask(b.venue, "the venue, room or delivery location", 150);
    if (!Array.isArray(b.hospitalityItems) || b.hospitalityItems.length === 0) {
      throw new BadRequest("Please choose at least one hospitality item.");
    }
    out.hospitalityItems = b.hospitalityItems.slice(0, 20).map((i) => text(i, 100)).filter(Boolean);
    out.hospitalityDetails = text(b.hospitalityDetails, 2000);
  } else {
    out.fulfilment = oneOf(b.fulfilment, ["Collection", "Delivery"], "collection or delivery");
    out.address = text(b.address, 500);
    if (out.fulfilment === "Delivery" && !out.address && !staff) {
      throw new BadRequest("Please give the delivery address.");
    }
    if (!b.lunches || typeof b.lunches !== "object") {
      throw new BadRequest("Please enter how many of each packed lunch you need.");
    }
    out.lunches = {};
    for (const [option, qty] of Object.entries(b.lunches).slice(0, 20)) {
      const n = wholeNumber(qty || 0, "the packed lunch quantities", 0, 2000);
      if (n > 0) out.lunches[text(option, 100)] = n;
    }
    if (Object.keys(out.lunches).length === 0) {
      throw new BadRequest("Please order at least one packed lunch.");
    }
    out.bespokeDetails = out.lunches[BESPOKE] ? text(b.bespokeDetails, 1000) : "";
    if (out.lunches[BESPOKE] && !out.bespokeDetails) {
      throw new BadRequest("Please describe the bespoke, themed or other lunch you would like.");
    }
    out.receiverName = ask(b.receiverName, "the name of the person receiving the order", 100);
    out.receiverPhone = ask(b.receiverPhone, "the receiver's contact number", 30);
  }

  return out;
}

function text(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

function required(value, label, max) {
  const v = text(value, max);
  if (!v) throw new BadRequest(`Please enter ${label}.`);
  return v;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new BadRequest(`Please choose ${label}.`);
  return value;
}

function email(value) {
  const v = required(value, "your email address", 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new BadRequest("Please enter a valid email address.");
  return v;
}

function isoDate(value) {
  const v = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
    throw new BadRequest("Please enter the booking date.");
  }
  return v;
}

function wholeNumber(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequest(`Please enter a whole number for ${label}.`);
  }
  return n;
}

// ---------- helpers ----------

async function readJson(req) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new BadRequest("The form is too long.");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new BadRequest("The form could not be read.");
  }
}

// Saves the booking under the next free reference for its site and date.
// "onlyIfNew" stops two bookings made at the same moment taking one number.
async function saveWithNewReference(booking) {
  const s = store();
  const [y, m, d] = booking.date.split("-");
  const prefix = SITE_CODES[booking.site] + d + m + y.slice(2);
  const { blobs } = await s.list({ prefix });
  const used = blobs.map((b) => Number(b.key.slice(prefix.length))).filter(Number.isInteger);
  let n = used.length ? Math.max(...used) + 1 : 1;
  for (let tries = 0; tries < 25; tries++, n++) {
    booking.id = prefix + String(n).padStart(3, "0");
    const { modified } = await s.setJSON(booking.id, booking, { onlyIfNew: true });
    if (modified) return;
  }
  throw new Error("Could not find a free booking reference for " + prefix);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
