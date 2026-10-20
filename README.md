# LWLAT catering bookings

A booking form for staff to request hospitality or packed lunches, and an admin page where the Catering Team can see, confirm and manage the requests. Everyone signs in with their LWLAT Microsoft account.

- **Booking form:** `https://<your-site>.netlify.app/`
- **Catering admin:** `https://<your-site>.netlify.app/admin`

Everything runs on Netlify. Bookings are stored in Netlify's own storage (Netlify Blobs), so there is no separate database or account to look after.

## What is in the folder

| File | What it does |
| --- | --- |
| `public/index.html` | The booking form that staff fill in |
| `public/admin.html` | The Catering Team's page, open only to people with the Catering admin role |
| `public/styles.css` | Shared colours, type and layout (trust teal #009f9a) |
| `public/auth.js` | Microsoft sign-in for both pages |
| `public/vendor/` | Microsoft's sign-in library (MSAL 4.30.0, MIT licence), kept here so the site does not depend on another server |
| `netlify/functions/bookings.mjs` | The small piece of server code that saves and returns bookings |
| `netlify/functions/config.mjs` | Tells the pages which Microsoft app to sign in with |
| `netlify/lib/auth.mjs` | Checks each sign-in with Microsoft and whether the person has the Catering admin role |
| `netlify/lib/notify.mjs` | Sends the email alerts |
| `netlify.toml` | Tells Netlify where each part lives |

## Putting it live on Netlify

1. Sign in to Netlify and choose **Add new site**, then **Import an existing project**.
2. Pick GitHub and choose the `lwlat-hospitality` repository.
3. Leave the build settings as Netlify suggests. It reads them from `netlify.toml`.
4. Before the first deploy, open **Site configuration**, then **Environment variables**, and add the two IDs from IT's "LWLAT Catering Bookings" app registration:

   | Key | Value |
   | --- | --- |
   | `ENTRA_TENANT_ID` | Directory (tenant) ID |
   | `ENTRA_CLIENT_ID` | Application (client) ID |

5. Deploy the site. Netlify will give it an address ending in `.netlify.app`.
6. Check with IT that this exact address, with a `/` on the end, is the **Single-page application** redirect URI on the app registration. If you add your own domain later, IT must add that address too, or sign-in will fail with an error mentioning "redirect URI".
7. Test it: sign in and send a booking from the form, then open `/admin` with a Catering Team account and check it appears.

## Who can do what

| Person | Booking form | Catering Team page |
| --- | --- | --- |
| Any LWLAT staff member | Signs in and books in their own name | No access |
| Catering Team (Catering admin role) | Books, and can add bookings for other people | Full access |
| Anyone outside LWLAT | Cannot sign in | No access |

To give someone access to the Catering Team page, or take it away, ask IT to change who has the **Catering admin** role on the "LWLAT Catering Bookings" app in Entra. Nothing changes on the website. Bookings from outside organisations are added by the Catering Team using **Add a booking**.

## Email alerts for catering managers

When someone sends a booking, the catering manager for that site gets an email with the full order, any allergy details and a link to the bookings page. A trust contact can be copied on every booking. Replying to the alert goes to the person who made the booking. Bookings the Catering Team adds themselves do not send an alert.

The alerts are sent through the trust's Microsoft 365 from one mailbox. Until the settings below are in place, bookings still work but no alerts are sent.

**From IT** (see the request below), add these in Netlify under **Site configuration**, then **Environment variables**:

| Key | Value |
| --- | --- |
| `GRAPH_TENANT_ID` | Directory (tenant) ID |
| `GRAPH_CLIENT_ID` | Application (client) ID of the email app |
| `GRAPH_CLIENT_SECRET` | The client secret value. Mark it as secret in Netlify. |
| `NOTIFY_FROM` | Optional. The mailbox alerts come from. If left out, `catering-notifications@lwlat.org.uk` is used. |

**Who gets told.** Add one key per site. Each can hold several addresses separated by commas.

| Key | Who it is for |
| --- | --- |
| `NOTIFY_BABINGTON` | Babington catering manager |
| `NOTIFY_HEATHERBROOK` | Heatherbrook catering manager |
| `NOTIFY_LANCASTER` | Lancaster catering manager |
| `NOTIFY_SOUTH_WIGSTON` | South Wigston catering manager |
| `NOTIFY_WOODSTOCK` | Woodstock catering manager |
| `NOTIFY_TRUST` | Copied on every booking, whichever site |

To change who is told, edit these values in Netlify and redeploy. No code changes are needed.

**What IT needs to set up:** an app registration with the Microsoft Graph application permission `Mail.Send`, with admin consent and a client secret. It should be limited to the sending mailbox only, using RBAC for Applications in Exchange Online or an application access policy. The secret expires, usually after 12 or 24 months, and must be renewed in Netlify before then.

## Changing the menus or notice period

Open `public/index.html` and look for the section headed **settings the Catering Team may want to change** near the bottom. You can edit:

- `MIN_NOTICE_WORKING_DAYS`, the number of working days' notice needed
- `HOSPITALITY_ITEMS`, the hospitality menu
- `LUNCH_OPTIONS`, the packed lunch choices

Keep each item inside quotation marks and followed by a comma. Old bookings keep the wording they were made with.

## Adding the trust logo

Save the logo as `public/lwlat-logo.svg` (or a PNG, and change the file name to match). Then remove the word `hidden` from the `<img>` line near the top of `index.html` and `admin.html`.

## How the admin page works

- **Needs a reply** shows new requests. The number on the tab is how many are waiting.
- **Upcoming** shows bookings from today onwards, grouped by day, leaving out declined and cancelled ones.
- Select a booking to see everything about it, change its status, add private notes for the team, or email the person who booked.
- **Download spreadsheet** saves the bookings you are looking at as a CSV file that opens in Excel.
- **Print list** prints the bookings you are looking at as a kitchen sheet.

The site does not send emails by itself. The Catering Team confirms each booking by email using the **Email** button on the booking.

## Data protection

The form collects staff names, work email addresses and phone numbers, and dietary or allergy details given as quantities. The form asks people not to name individuals in the dietary box.

- Bookings stay in Netlify's storage until the Catering Team deletes them. Agree how long to keep them, for example to the end of the term after the event, and delete old bookings on that schedule.
- Everyone signs in with their LWLAT Microsoft account. The website receives each person's name and work email from Microsoft, and nothing else. Only people with the Catering admin role can see or change bookings, and each booking records who made it and who last changed it.
- When someone leaves the Catering Team, ask IT to remove their Catering admin role.
- If the form will ever be used to collect information about individual learners, such as named allergies for a trip, it needs sign-off from the trust's Data Protection Officer first.
