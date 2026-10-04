<div align="center">

# Syncronify

**The campus event platform: discover events, RSVP, plan your week, chat with attendees, and ask an AI assistant what's on.**

**[Live app](https://syncronify-self.vercel.app)** · **[Test accounts](TEST_ACCOUNTS.md)**

</div>

---

## What it is

Campus events are scattered across WhatsApp groups, posters and emails, so students miss things and clubs can't tell who's coming. Syncronify puts them in one place:

- **Students** find events, RSVP in one tap, keep a personal calendar and chat with other attendees.
- **Clubs** publish events, manage registrations and waitlists, and check people in at the door.
- **Admins** approve which clubs can publish and keep the platform tidy.

Built for CS253 (Software Development and Operations) at IIT Kanpur.

## Features

- **Discover and RSVP:** search and filter events; capacity limits with an automatic waitlist that moves people up when a seat frees; a warning when an RSVP clashes with something already in your calendar.
- **Plan:** a calendar of everything you're attending or planning, notes, a venue map, QR entry codes for the door, and "Add to calendar" files.
- **Stay in the loop:** event chats, organizer announcements, notifications and automatic reminders.
- **Ask Sync:** an AI assistant that answers questions like *"What's on this weekend?"* from live event data.
- **Run events as a team:** invite co-organisers and door staff to an event, scan attendees in by QR, and rate events afterwards.
- **Organizer and admin consoles:** stats, attendee lists, check-in, CSV export, user management, organizer approvals and an event report queue.

## Tech stack

| Part | Built with |
| --- | --- |
| Web app | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| API | Node.js, Express 5, TypeScript, zod |
| Database | MongoDB with Mongoose (MongoDB Atlas in production) |
| Realtime | Socket.io (polling fallback on serverless hosts) |
| Auth | JWT and bcrypt, with email verification and password reset |
| Email | Transactional outbox, delivered by cron or an in-process worker |
| AI | Any OpenAI-compatible API (OpenAI in production) |
| Hosting | Vercel |

## Getting started

You need **Node.js 20.19+**. MongoDB is optional: the command below runs a local database for you.

```bash
git clone https://github.com/sakshamm21/syncronify.git
cd syncronify
npm run install:all
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev:memory
```

Open **http://localhost:3000** and sign in with any [test account](TEST_ACCOUNTS.md), for example `member@syncronify.dev` / `syncronify123`. The first run downloads MongoDB once (about 780 MB).

No email service is needed: verification codes and password-reset links are shown on screen when email isn't configured.

To use your own MongoDB instead, set `DB_URI` in `server/.env`, then run `npm --prefix server run seed` and `npm run dev`.

## Configuration

Settings live in `server/.env` and `client/.env`; the `.env.example` files list them all. The main ones:

| Variable | Purpose |
| --- | --- |
| `DB_URI` | MongoDB connection string (required in production) |
| `JWT_SECRET` | Long random string for signing logins (required in production) |
| `CLIENT_URL` | Web app address(es) allowed to call the API |
| `CRON_SECRET` | Bearer token Vercel Cron uses to run the scheduled jobs |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Turn on the AI assistant; leave the key empty to turn it off |
| `BREVO_API_KEY` or `SMTP_*`, plus `MAIL_FROM` | Send real emails (optional) |
| `NEXT_PUBLIC_API_URL` | Where the web app finds the API |
| `NEXT_PUBLIC_SITE_URL` | This app's own address, used for shared-link previews |

## Scheduled jobs

On a long-running host these run on in-process timers. On Vercel, `vercel.json`
schedules them instead, each requiring `Authorization: Bearer $CRON_SECRET`:

| Job | What it does |
| --- | --- |
| `/api/jobs/event-reminders` | Emails attendees 24 hours before an event starts. |
| `/api/jobs/email-outbox` | Delivers queued notification emails. |
| `/api/jobs/maintenance` | Recomputes `attendeeCount` from the registrations that exist, and prunes old rows. |

## Project structure

```text
client/   Next.js web app: pages in src/app, components in src/components, API client in src/lib/api
server/   Express API: feature modules in src/modules, models in src/models, demo data in scripts/
```

## Deployment

Both apps run on **Vercel** with **MongoDB Atlas**: the web app from `client/`, and the API from `server/` as a serverless function with a daily cron job for reminders. Set the variables above in each Vercel project, then deploy with `vercel deploy --prod`.

## License

ISC.

<sub>Made by [Saksham Malhotra](https://github.com/sakshamm21).</sub>
