// Emails the catering manager for a booking's site when a new request comes in.
// Mail is sent through Microsoft Graph from a trust mailbox. Nothing is sent
// until these Netlify environment variables are set:
//
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET   from IT's app registration
//   NOTIFY_FROM          the mailbox the alerts come from (optional, defaults to
//                        catering-notifications@lwlat.org.uk)
//   NOTIFY_BABINGTON, NOTIFY_HEATHERBROOK, NOTIFY_LANCASTER, NOTIFY_SOUTH_WIGSTON,
//   NOTIFY_WOODSTOCK, NOTIFY_CENTRAL_TEAM    who to tell for each site
//   NOTIFY_TRUST         who to copy on every booking (optional)
//   SITE_URL             the site's address, for the link to the admin page (optional,
//                        Netlify sets URL automatically)
//
// Each NOTIFY_ variable can hold several addresses separated by commas.
//
// Every attempt returns { sent, to, reason } so the admin page can show what
// happened to each booking's alert without anyone reading the server logs.

const env = (name) => (process.env[name] || "").trim();
const DEFAULT_FROM = "catering-notifications@lwlat.org.uk";
const GRAPH_SETTINGS = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"];

export const siteKey = (site) => "NOTIFY_" + site.toUpperCase().replace(/[^A-Z]+/g, "_");
export const sender = () => env("NOTIFY_FROM") || DEFAULT_FROM;
export const missingSettings = () => GRAPH_SETTINGS.filter((name) => !env(name));

export function recipients(site) {
  const list = [env(siteKey(site)), env("NOTIFY_TRUST")].join(",")
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  return [...new Set(list)];
}

export async function notifyNewBooking(booking) {
  const to = recipients(booking.site);
  if (!to.length) {
    return { sent: false, to, reason: `No alert address is set for ${booking.site}. Add ${siteKey(booking.site)} or NOTIFY_TRUST in Netlify, then redeploy.` };
  }
  const adminUrl = (env("SITE_URL") || env("URL")).replace(/\/$/, "") + "/admin";
  return sendMail({
    to,
    subject: subject(booking),
    html: bookingEmail(booking, {
      banner: `New ${booking.type === "hospitality" ? "hospitality" : "packed lunch"} booking for ${esc(booking.site)}`,
      button: { href: adminUrl, label: "Open the bookings page" },
      footer: `Replying to this email will go to ${esc(booking.name)}. To confirm the booking, open it on the bookings page and choose Confirm order.`,
    }),
    // Replies go to the person who made the booking.
    replyTo: booking.email ? { address: booking.email, name: booking.name } : null,
  });
}

// Tells the booker their order is confirmed. Replies go to the team member
// who confirmed it.
export async function sendBookingConfirmation(booking, confirmer) {
  if (!booking.email) {
    return { sent: false, to: [], reason: "This booking has no email address for the booker." };
  }
  const first = String(booking.name || "").trim().split(/\s+/)[0];
  return sendMail({
    to: [booking.email],
    subject: `Booking confirmed: ${booking.eventName}, ${shortDate(booking.date)} (${booking.id})`,
    html: bookingEmail(booking, {
      banner: "Your catering booking is confirmed",
      intro: `<p style="margin:0 0 12px">Hello ${esc(first || booking.name)},</p>
        <p style="margin:0 0 16px">The Catering Team has confirmed your booking. The details are below. If anything changes, or if something is not right, please reply to this email.</p>`,
      footer: `Confirmed by ${esc(confirmer.name || confirmer.email)}, Catering Team, Learning Without Limits Academy Trust.`,
    }),
    replyTo: confirmer.email ? { address: confirmer.email, name: confirmer.name } : null,
  });
}

// Sends one email and reports what happened. It never throws.
export async function sendMail({ to, subject, html, replyTo }) {
  const missing = missingSettings();
  if (missing.length) {
    return { sent: false, to, reason: `Email settings missing in Netlify: ${missing.join(", ")}. Add them with Functions included in their scopes, then redeploy.` };
  }
  try {
    const token = await getToken();
    const from = sender();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          replyTo: replyTo ? [{ emailAddress: replyTo }] : [],
        },
        saveToSentItems: false,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = (data.error && data.error.code) || String(res.status);
      return { sent: false, to, reason: explainSendError(res.status, code, from) };
    }
    return { sent: true, to };
  } catch (err) {
    console.error("Booking alert failed", err);
    return { sent: false, to, reason: err.message };
  }
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
  if (res.ok && data.access_token) return data.access_token;

  const detail = String(data.error_description || "").split("\r\n")[0];
  let reason = `Microsoft refused the email app's sign-in (${data.error || res.status}).`;
  if (/AADSTS7000215|AADSTS7000222/.test(detail)) {
    reason = "Microsoft rejected GRAPH_CLIENT_SECRET. Check it is the secret's Value, not its Secret ID, and that it has not expired.";
  } else if (/AADSTS700016/.test(detail)) {
    reason = "Microsoft could not find the email app. Check GRAPH_CLIENT_ID and GRAPH_TENANT_ID are the right IDs for the alerts app.";
  } else if (/AADSTS90002|AADSTS900023/.test(detail)) {
    reason = "Microsoft did not recognise GRAPH_TENANT_ID. Check it is the Directory (tenant) ID.";
  }
  throw new Error(reason + (detail ? ` Microsoft said: ${detail}` : ""));
}

function explainSendError(status, code, from) {
  if (status === 401 || status === 403 || code === "ErrorAccessDenied") {
    return `The email app is not allowed to send from ${from} (${code}). Ask IT to check the Mail.Send application permission has admin consent and that the access policy includes this mailbox.`;
  }
  if (status === 404 || code === "ErrorInvalidUser" || code === "MailboxNotEnabledForRESTAPI") {
    return `The mailbox ${from} was not found or cannot send email (${code}). Check IT has created it and that NOTIFY_FROM, if set, is spelt correctly.`;
  }
  return `Microsoft could not send the email (${code}).`;
}

// ---------- the email ----------

function subject(b) {
  const allergy = b.dietary === "Yes" ? " (dietary needs)" : "";
  return `New catering booking: ${b.eventName}, ${b.site}, ${shortDate(b.date)}${allergy}`;
}

function bookingEmail(b, { banner, intro = "", button = null, footer }) {
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
    <div style="background:#009f9a;color:#fff;padding:14px 18px;border-radius:6px 6px 0 0;font-weight:bold;font-size:17px">
      ${banner}
    </div>
    <div style="border:1px solid #c8dddb;border-top:0;padding:16px 18px;border-radius:0 0 6px 6px">
      ${intro}
      <p style="margin:0 0 12px"><strong style="font-size:17px">${esc(b.eventName)}</strong><br>Reference ${esc(b.id)}</p>
      ${allergy}
      <table style="border-collapse:collapse">
        ${row("Site", esc(b.site))}
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
      ${button ? `<p style="margin:20px 0 0"><a href="${esc(button.href)}" style="display:inline-block;background:#00706c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p>` : ""}
      <p style="margin:16px 0 0;color:#4b6664;font-size:13px">${footer}</p>
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
