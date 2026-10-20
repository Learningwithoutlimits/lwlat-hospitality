// Bookings API for the hospitality form and the catering admin page.
//
//   POST   /api/bookings        any signed-in staff member, creates a booking
//                                request. With "staffEntry": true, the Catering
//                                Team adds a booking by hand, with looser rules.
//   GET    /api/bookings        Catering Team, lists every booking
//   PATCH  /api/bookings/:id    Catering Team, updates status and catering notes
//   DELETE /api/bookings/:id    Catering Team, deletes a booking
//
// Every request carries the person's Microsoft sign-in token as
// "Authorization: Bearer <token>". The Catering Team are the people with the
// Catering.Admin app role in Entra.

import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { notifyNewBooking } from "../lib/notify.mjs";
import { signedInUser } from "../lib/auth.mjs";

export const config = {
  path: ["/api/bookings", "/api/bookings/:id"],
};

const SITES = ["Babington", "Heatherbrook", "Lancaster", "South Wigston", "Woodstock"];
const TYPES = ["hospitality", "packed-lunch"];
const STATUSES = ["New", "Confirmed", "Declined", "Cancelled", "Completed"];
const MAX_BODY_BYTES = 20000;
const BESPOKE = "Bespoke, themed or other";

const store = () => getStore({ name: "bookings", consistency: "strong" });

export default async (req, context) => {
  const id = context.params?.id;
  try {
    const user = await signedInUser(req);
    if (!user) return json({ error: "Please sign in with your LWLAT Microsoft account." }, 401);
    if (req.method === "POST" && !id) return await createBooking(req, user);
    if (!user.isAdmin) return json({ error: "Your account does not have access to the Catering Team page." }, 403);
    if (req.method === "GET" && !id) return await listBookings();
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

async function createBooking(req, user) {
  const body = await readJson(req);
  const staff = body.staffEntry === true;
  if (staff && !user.isAdmin) {
    return json({ error: "Your account does not have access to add bookings for the Catering Team." }, 403);
  }
  // A normal booking is always made in the signed-in person's own name.
  if (!staff) {
    body.name = user.name || user.email;
    body.email = user.email;
  }

  // Honeypot field, hidden from people. Bots tend to fill it in.
  if (body.website) return json({ ok: true, reference: "HB-000000-0000" }, 201);

  const booking = validateBooking(body, staff);
  const now = new Date();
  booking.id = makeReference(now);
  if (staff) {
    booking.status = body.status === undefined ? "Confirmed" : oneOf(body.status, STATUSES, "a status");
    booking.cateringNotes = text(body.cateringNotes, 2000);
    booking.addedByStaff = true;
  } else {
    booking.status = "New";
    booking.cateringNotes = "";
  }
  booking.submittedBy = { name: user.name, email: user.email };
  booking.createdAt = now.toISOString();
  booking.updatedAt = booking.createdAt;

  await store().setJSON(booking.id, booking);

  // Tell the site's catering manager. Bookings the team adds themselves need
  // no alert, and a failed email must not lose the booking.
  if (!staff) {
    try {
      await notifyNewBooking(booking);
    } catch (err) {
      console.error("Booking alert failed", booking.id, err);
    }
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

function makeReference(date) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `HB-${ymd}-${rand}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
