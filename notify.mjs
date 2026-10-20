// Emails the catering manager for a booking's site when a new request comes in.
// Mail is sent through Microsoft Graph from a trust mailbox. Nothing is sent
// until these Netlify environment variables are set:
//
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET   from IT's app registration
//   NOTIFY_FROM          the mailbox the alerts come from (optional, defaults to
//                        catering-notifications@lwlat.org.uk)
//   NOTIFY_BABINGTON, NOTIFY_HEATHERBROOK, NOTIFY_LANCASTER,
//   NOTIFY_SOUTH_WIGSTON, NOTIFY_WOODSTOCK   who to tell for each site
//   NOTIFY_TRUST         who to copy on every booking (optional)
//   SITE_URL             the site's address, for the link to the admin page (optional,
//                        Netlify sets URL automatically)
//
// Each NOTIFY_ variable can hold several addresses separated by commas.

const env = (name) => (process.env[name] || "").trim();
const DEFAULT_FROM = "catering-notifications@lwlat.org.uk";

function recipients(site) {
  const key = "NOTIFY_" + site.toUpperCase().replace(/[^A-Z]+/g, "_");
  const list = [env(key), env("NOTIFY_TRUST")].join(",")
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  return [...new Set(list)];
}

export async function notifyNewBooking(booking) {
  const to = recipients(booking.site);
  const from = env("NOTIFY_FROM") || DEFAULT_FROM;
  if (!to.length || !env("GRAPH_CLIENT_SECRET")) {
    console.log("Booking alert not sent: email settings are not complete.");
    return;
  }

  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: subject(booking),
        body: { contentType: "HTML", content: html(booking) },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        // Replies go to the person who made the booking.
        replyTo: booking.email ? [{ emailAddress: { address: booking.email, name: booking.name } }] : [],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
}

async function getToken() {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env("GRAPH_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GRAPH_CLIENT_ID"),
      client_secret: env("GRAPH_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Graph sign-in failed: ${res.status} ${data.error || ""}`);
  return data.access_token;
}

// ---------- the email ----------

function subject(b) {
  const allergy = b.dietary === "Yes" ? " (dietary needs)" : "";
  return `New catering booking: ${b.eventName}, ${b.site}, ${shortDate(b.date)}${allergy}`;
}

function html(b) {
  const adminUrl = (env("SITE_URL") || env("URL")).replace(/\/$/, "") + "/admin";
  const row = (label, value) => value
    ? `<tr><td style="padding:6px 16px 6px 0;color:#4b6664;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:6px 0;vertical-align:top">${value}</td></tr>`
    : "";

  let order;
  if (b.type === "hospitality") {
    order = row("Room or location", esc(b.venue)) +
      row("Items", (b.hospitalityItems || []).map(esc).join("<br>")) +
      row("Details", esc(b.hospitalityDetails).replace(/\n/g, "<br>"));
  } else {
    order = row("Lunches", Object.entries(b.lunches || {}).map(([k, v]) => `${v} x ${esc(k)}`).join("<br>")) +
      row("Bespoke, themed or other", esc(b.bespokeDetails)) +
      row("Collection or delivery", esc(b.fulfilment)) +
      row("Delivery address", esc(b.address).replace(/\n/g, "<br>")) +
      row("Receiver", [esc(b.receiverName), esc(b.receiverPhone)].filter(Boolean).join(", "));
  }

  const allergy = b.dietary === "Yes"
    ? `<p style="margin:16px 0;padding:12px 14px;background:#fff0e3;border:2px solid #eaa77c;border-radius:6px;color:#8a2c0d">
         <strong>Dietary needs or allergies</strong><br><span style="color:#15302f">${esc(b.dietaryDetails).replace(/\n/g, "<br>")}</span></p>`
    : "";

  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#15302f;max-width:600px">
    <div style="background:#009f9a;color:#fff;padding:14px 18px;border-radius:6px 6px 0 0;font-weight:bold">
      New ${b.type === "hospitality" ? "hospitality" : "packed lunch"} booking for ${esc(b.site)}
    </div>
    <div style="border:1px solid #c8dddb;border-top:0;padding:16px 18px;border-radius:0 0 6px 6px">
      <p style="margin:0 0 12px"><strong style="font-size:17px">${esc(b.eventName)}</strong><br>Reference ${esc(b.id)}</p>
      ${allergy}
      <table style="border-collapse:collapse">
        ${row("Date", esc(longDate(b.date)))}
        ${row("Time", esc(b.time))}
        ${row("Number of people", esc(b.people))}
        ${order}
        ${row("Other information", esc(b.notes).replace(/\n/g, "<br>"))}
        ${row("Booked by", `${esc(b.name)}, ${esc(b.department)}`)}
        ${row("Email", esc(b.email))}
        ${row("Telephone", esc(b.phone))}
        ${row("Cost centre", esc(b.costCentre))}
      </table>
      <p style="margin:20px 0 0"><a href="${esc(adminUrl)}" style="display:inline-block;background:#00706c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open the bookings page</a></p>
      <p style="margin:16px 0 0;color:#4b6664;font-size:13px">Replying to this email will go to ${esc(b.name)}. Please confirm or decline the booking on the bookings page.</p>
    </div>
  </div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function longDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
  });
}

function shortDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
  });
}
