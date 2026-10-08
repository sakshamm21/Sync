# Test accounts and demo data

Sync normally emails verification codes and password-reset links. This project runs **without an email service**, so it ships with ready-made accounts and realistic demo data that anyone can use straight away.

> **Every account uses the password `syncronify123`.**
> These are public test credentials. Don't store anything private in them.

- **Live app:** https://sync-campus.vercel.app → **Sign in**. The sign-in page has one-click buttons for the Member, Organizer and Admin accounts.
- **On your machine:** `npm run dev:memory` loads this data automatically on first run (see the [README](README.md#getting-started)).

The data itself lives in [`server/scripts/demo-data.ts`](server/scripts/demo-data.ts), as plain, readable data; edit it to add your own accounts or events.

---

## Accounts

| Email | Role | Use it to… |
| --- | --- | --- |
| `member@syncronify.dev` | Member | **Start here.** Kabir already has tickets, private plans, notes, event chats and unread notifications. |
| `organizer@syncronify.dev` | Organizer | Run events for the *Tech & Computing Society*: a full hackathon with a waitlist, a draft, a cancelled event, and a past event with check-ins. |
| `cultural@syncronify.dev` | Organizer | Run events for the *Cultural Affairs Council*. |
| `sports@syncronify.dev` | Organizer | Run events for the *Sports Council*. |
| `admin@syncronify.dev` | Admin | Manage users, approve or reject organizer applications, moderate events. |
| `asha@syncronify.dev` | Member | Has a **pending** organizer application (Photography Club). Approve it as admin and watch her become an organizer. |
| `rahul@syncronify.dev` | Member | His organizer application was **rejected** with a note; he also gave up his hackathon seat. |
| `priya@syncronify.dev` | Member | Was **moved off the waitlist** into the hackathon; has a "You're in" notification. |
| `ishaan@syncronify.dev` | Member | Still **on the waitlist** for the full hackathon. |
| `suspended@syncronify.dev` | Member (suspended) | Signing in shows the "account suspended" message. |
| `tester1@syncronify.dev` … `tester5@syncronify.dev` | Member | **Clean accounts** with no activity: walk through the app as a brand-new user, or let several people test at once without stepping on each other. |

---

## What's in the data

Dates are relative to the day the data was loaded, so there are always upcoming events.

| Event | Organizer | When | What it demonstrates |
| --- | --- | --- | --- |
| Intro to Rust Workshop | Tech | tomorrow | A normal workshop with spots left |
| Sunrise Yoga | Sports | in 2 days | Early-morning event, photo cover |
| Tech Summit 2026 | Tech | in 3 days | Big conference with an **event chat** and an organizer **announcement** |
| AI Reading Group: Building Agents | Tech | in 4 days | **Online** event (meeting link instead of a venue) |
| Inter-Hall Football Finals | Sports | in 5 days | Chat announcement to attendees |
| Open-Air Movie Night | Cultural | in 6 days | Social event |
| 24h Design & Build Hackathon | Tech | in 7 days, runs 24 h | **Full** (3/3) with a **waitlist**; spans two days |
| Robotics Demo Day | Tech | in 9 days | **Cancelled**; attendees got a cancellation notification |
| Annual Cultural Fest: Live Band Night | Cultural | in 10 days | Popular evening event |
| Campus 5K Fun Run | Sports | in 12 days | Large capacity |
| Open Mic & Poetry Evening | Cultural | in 14 days | Gradient cover (no photo) |
| Watercolour & Sketching Workshop | Cultural | in 17 days | Small workshop |
| Cloud & DevOps Bootcamp | Tech | in 20 days | **Nearly full** ("3 left" sticker) |
| Startup Pitch Night | Tech | in 21 days | **Draft**: only the organizer (and admins) can see it |
| Badminton Doubles League | Sports | in 25 days | Weekend-long, no registrations yet |
| Open Source Contributors Meetup | Tech | 6 days ago | **Past** event with check-ins (organizer attendance rate: 67%) |
| Photo Walk: Campus at Dusk | Cultural | 12 days ago | Past event |
| Study group: Operating Systems, Gym session | Kabir (member) | this week | **Private** plans: only Kabir sees them, not even admins |

Plus notes for Kabir and the organizers, and the two organizer applications above.

---

## Things to try

**As `member@syncronify.dev`**
- Dashboard: your tickets, recommendations from your interests, the bell with unread notifications.
- Explore: search, filter by category, RSVP to something new (and enjoy the confetti).
- Schedule: your week in a calendar, including private plans; click a day to add one. Your **entry code** for the next event is at the bottom.
- Open *Tech Summit 2026* → chat with other attendees.
- RSVP to something that overlaps an existing plan → you get a *"clashes with…"* warning (the RSVP still goes through).
- Ask Sync (header button or <kbd>Ctrl</kbd>+<kbd>J</kbd>): *"What's on my calendar this week?"* or *"Any tech events this weekend?"*

**As `organizer@syncronify.dev`**
- Organizer console: stats, the full hackathon, the draft and the cancelled event.
- Open *Open Source Contributors Meetup*: **The team** panel lists Asha (co-organiser) and Rahul (door staff). Change a role or remove someone.
- Open any event's **Door check-in** → **Scan entry codes** (works on a phone with a camera; browsers without `BarcodeDetector` fall back to the attendee list).
- Open an event's **Attendees**: check people in, export CSV. Door staff can scan but cannot see this list, because it holds everyone's email.
- Post an **announcement** in an event chat (attendees are notified).
- Rate a finished event (5 stars on *Open Source Contributors Meetup*) or publish the draft.

**As `rahul@syncronify.dev`** (door staff on that meetup)
- Open the event from your organizer console: you can scan entry codes, but the attendee list and event editing are both hidden.

**As `admin@syncronify.dev`**
- Approve Asha's application, then sign in as `asha@` and publish an event.
- **Reports** tab: a member's report on an event. *Cancel event* closes it and cancels the event; *Dismiss* closes it without.
- Suspend a tester account, then try signing in as it.

**Waitlist in action:** sign in as `member@` and leave the hackathon. Then sign in as `ishaan@`: he's been moved up and notified.

---

## Signing up and resetting passwords

The live app sends real emails (from `Sync <sak.projects.auth@gmail.com>` via Brevo), so to create your own account you need a **real inbox**: the verification code and password reset links arrive by email. Check spam if they don't show up within a minute. The test accounts above are already verified and need no email.

When running locally without `BREVO_API_KEY` or SMTP settings, codes and reset links are **shown on screen** instead, so any made-up address works.

---

## Resetting the data

People will change the shared accounts (RSVPs, notes, approvals). To start fresh:

```bash
# Local, with npm run dev:memory: stop the app, then
rm -rf server/.data          # next `npm run dev:memory` reloads the demo data

# Any database (uses DB_URI from server/.env)
npm --prefix server run seed -- --reset   # wipes everything, then loads fresh data with new dates
```

The seed script refuses to run with `NODE_ENV=production`, so it can't wipe a production database by accident.
