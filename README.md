# LWLAT catering bookings

A booking form for staff to request hospitality or packed lunches, and an admin page where the Catering Team can see, confirm and manage the requests.

- **Booking form:** `https://<your-site>.netlify.app/`
- **Catering admin:** `https://<your-site>.netlify.app/admin`

Everything runs on Netlify. Bookings are stored in Netlify's own storage (Netlify Blobs), so there is no separate database or account to look after.

## What is in the folder

| File | What it does |
| --- | --- |
| `public/index.html` | The booking form that staff fill in |
| `public/admin.html` | The Catering Team's page, protected by a password |
| `public/styles.css` | Shared colours, type and layout (trust teal #009f9a) |
| `netlify/functions/bookings.mjs` | The small piece of server code that saves and returns bookings |
| `netlify.toml` | Tells Netlify where each part lives |

## Putting it live on Netlify

1. Sign in to Netlify and choose **Add new site**, then **Import an existing project**.
2. Pick GitHub and choose the `lwlat-hospitality` repository.
3. Leave the build settings as Netlify suggests. It reads them from `netlify.toml`.
4. Before the first deploy, open **Site configuration**, then **Environment variables**, and add:
   - **Key:** `ADMIN_PASSWORD`
   - **Value:** a long passphrase that only the Catering Team will know, for example four random words.
5. Deploy the site. Netlify will give it an address ending in `.netlify.app`. You can add your own domain later.
6. Test it: send a booking from the form, then sign in at `/admin` and check it appears.

To change the password, edit `ADMIN_PASSWORD` in Netlify and redeploy. Anyone who is signed in will be asked for the new one.

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
- The admin password is the only thing protecting the bookings. Use a long one, share it only with the Catering Team, and change it when someone leaves.
- If the form will ever be used to collect information about individual learners, such as named allergies for a trip, it needs sign-off from the trust's Data Protection Officer first.
