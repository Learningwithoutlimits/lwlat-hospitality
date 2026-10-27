// Lets the Catering Team check the email alerts from the admin page.
// It shows who each site's alerts go to, and sends one test email to the
// signed-in person only, so the catering managers are not disturbed.

import { signedInUser } from "../lib/auth.mjs";
import { missingSettings, recipients, sendMail, sender, siteKey } from "../lib/notify.mjs";

export const config = { path: "/api/alert-test", method: "POST" };

const SITES = ["Babington", "Heatherbrook", "Lancaster", "South Wigston", "Woodstock", "Central Team"];

export default async (req) => {
  const user = await signedInUser(req);
  if (!user) return json({ error: "Please sign in with your LWLAT Microsoft account." }, 401);
  if (!user.isAdmin) return json({ error: "Your account does not have access to the Catering Team page." }, 403);

  const routing = SITES.map((site) => ({ site, key: siteKey(site), to: recipients(site) }));
  const test = user.email
    ? await sendMail({
        to: [user.email],
        subject: "Test: catering booking alerts",
        html: `<p style="font-family:Arial,sans-serif">This is a test from the LWLAT catering bookings page. If you can read this, booking alerts can be sent from ${sender()}.</p>`,
      })
    : { sent: false, to: [], reason: "Your Microsoft account has no email address to send the test to." };

  return json({ from: sender(), missing: missingSettings(), routing, test });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
