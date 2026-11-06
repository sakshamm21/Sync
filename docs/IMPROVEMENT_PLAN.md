# Sync: bug-fix and product plan

Written 2026-11-06 from a full read of `server/` and `client/src/`, plus these checks:

- `npm --prefix server run typecheck`: passes.
- `npm test`: 123 of 123 pass.
- `npm run build` (web app): passes.
- Nine suspected server bugs were reproduced against an in-memory database (marked **reproduced** below).
- The live API was queried: `GET https://sync-campus-api.vercel.app/api/events` returns **0 upcoming events**.

The plan has three parts:

1. **Bugs** (Phases 0 to 3), ordered by how much they hurt real users. Every item says where the problem is, what goes wrong, how to fix it and how to prove the fix.
2. **Engineering foundations** (Phase 4): the tooling that keeps these bugs from coming back.
3. **Product roadmap** (Phase 5): what would make Sync more useful to students, organisers and admins, split into Now / Next / Later.

---

## Instructions for the agent doing this work

- Work one PR per workstream, in the order of the **PR plan** at the end. Keep PRs small enough to review.
- Before writing web-app code, read `client/AGENTS.md`. This project uses Next.js 16, whose APIs differ from older versions; the docs are in `client/node_modules/next/dist/docs/`.
- Every server bug fix gets a regression test in `server/test/` written in the existing style (supertest against the in-memory MongoDB; see `test/helpers.ts`). Write the test first, watch it fail, then fix.
- Before opening each PR, run all three: `npm --prefix server run typecheck`, `npm test` and `npm run build`.
- Keep `README.md` and `TEST_ACCOUNTS.md` truthful. Several README claims below are not true today (email retries, report notifications, date filters, working QR codes). Fix the code, or change the claim.
- Do not change behaviour the plan doesn't mention. Where a fix needs a product decision, the plan proposes a default. Use the default and list it in the PR description; the open questions are collected at the end.
- The codebase has a consistent voice: plain-English comments, small services and one policy module. Follow it.

Severity labels:

- **P0**: a core feature is broken or there is a security or permissions hole.
- **P1**: real users hit it, or data is wrong.
- **P2**: an edge case, hardening, or polish.

---

## Phase 0: The live demo is empty (do this first)

### B0. The demo data has run out, and the shared demo accounts can be vandalised (P0, ops)

- **What's wrong.** Demo events are seeded relative to the day the seed ran. The live database was last seeded around 2 Oct 2026, and its last event was on 27 Oct. Today, anyone who follows the README's "Open the live app" link sees an empty Explore page, an empty landing-page ticket fan (`FeaturedEvents` renders nothing) and no recommendations.
- **Abuse is already visible.** The shared organizer account has published a junk event titled "ASDFGHJ". Anyone can sign in as `member@` and change its password in Settings, which locks everyone else out. Anyone can sign in as `admin@` and suspend or demote the other demo accounts.
- **Fix: add a `DEMO_MODE=true` server flag.** When it is on:
  1. **Nightly reset.** Add a protected job, `GET /api/jobs/demo-reset` behind `CRON_SECRET`, that wipes the demo data and re-runs the seed from `scripts/seed.ts`. Move the seed logic into a function the job can call. It should refuse to run unless `DEMO_MODE` is on. Schedule it daily.
  2. **Protect the seeded accounts** (those with a `@syncronify.dev` email). Block password change, password reset, and admin role or status changes on them, with a friendly 403: "Demo accounts can't be changed."
  3. **Optionally**, cap how many public events one demo organizer can publish per day.
- **Seed in the campus time zone.** `seed.ts` builds its `at()` dates in server-local time, so a seed run on Vercel or CI (both UTC) lands at odd hours for an Indian campus. Use the campus time zone from B14.
- **Test.** A job test that runs the reset and asserts upcoming events exist. A test that a demo account's `POST /api/me/password` returns 403 in demo mode.
- **CI.** Add a step to the `verify-deploy` job that fails if `GET $API_URL/api/events` reports `meta.total == 0`. That check would have caught this.

---

## Phase 1: P0 bugs (broken core features, permissions holes)

### B1. Entry-code QR codes cannot be scanned (P0)

- **Where:** `client/src/components/events/QrTicket.tsx:60-227` (the in-tree encoder).
- **What's wrong.** The encoder treats every QR version as a single Reed-Solomon block: `dataCodewords = totalCodewords - ecPerBlock` at line 84, where the table holds EC codewords *per block*. At level M that is only true for versions 1-3. From version 4 up, the data capacity is wrong and the blocks are not interleaved. Versions 7 and up also need two version-information areas, which are never drawn. A ticket token is about 264 bytes (a JWT carrying three ObjectIds), so it needs about version 12. The encoder instead draws a malformed "version 10" that no reader can decode.
- **Fix, two parts:**
  1. Replace the hand-written encoder with a maintained library, such as `qrcode` (render to SVG) or `qrcode-generator`. If you keep an in-tree encoder, it must implement block splitting and interleaving, version information, and every version up to 40.
  2. Shrink the ticket so it scans fast off a phone screen in a dim corridor. For example: `base64url(registrationId) + '.' + base64url(HMAC-SHA256(secret, registrationId + eventId)).slice(0, 22)`, about 60 characters, which fits version 4-5. Keep the server checks as they are: the live registration must exist, be `going`, and be for this event. Use a separate secret, or at least a separate purpose string, from session JWTs (see B48).
- **Test.** A unit test that encodes a real ticket and decodes the matrix with `jsqr` in Node, asserting the round trip. Then scan from a real phone.

### B2. The door scanner shows a black square and floods the API (P0)

- **Where:** `QrTicket.tsx:346-414`.
- **No video.** The `<video>` element only renders when `scanning` is true. `start()` calls `setScanning(true)` and then reads `videoRef.current` on the very next line (371), before React has re-rendered. The ref is still null, so `srcObject` is never set and the detector is asked to read an empty video forever.
- **Request flood.** The loop checks `!busy` (line 392), but that `busy` is a stale value captured when `start()` ran, so it is always false. Once a code is in view, every frame after a scan finishes POSTs `/scan` again. That hits the 300/min API limiter within seconds and locks the door phone out.
- **Camera left on.** Nothing stops the camera when the component unmounts, so navigating away keeps it running.
- **No iPhone support.** `BarcodeDetector` doesn't exist in iOS Safari or desktop Firefox. Most door staff on iPhones get "This browser cannot scan QR codes".
- **Fix:**
  1. Always render the `<video>` (hide it when idle), or attach the stream in an effect that runs when `scanning` becomes true.
  2. Keep `busy` and the last scanned token in refs. Ignore the same token for about 3 seconds.
  3. Stop the tracks in an unmount cleanup.
  4. When `BarcodeDetector` is missing, fall back to a JS decoder (`jsqr` on canvas frames at about 8 fps, or `qr-scanner`).
  5. Give clear feedback on each scan: a green or red full-width banner, `navigator.vibrate`, and a short beep.
- **Test.** Playwright with a fake camera (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m of a QR>`), asserting exactly one `/scan` request per code. Then test by hand on an iPhone.

### B3. Door staff cannot reach their own check-in screen (P0)

- **Where:**
  - `client/src/components/organizer/EventManagement.tsx:49`
  - `OrganizerConsole.tsx:160-178`
  - `RsvpButton.tsx:43-56`
- **What's wrong.**
  - The manage page loads `eventsApi.get` and `eventsApi.attendees` in one `Promise.all`. The attendee list needs management rights (`registrations.service.ts:77`), so for door staff the whole load fails and the page shows "Event not available". The scanner, the one thing door staff are for, is never shown. (The "door staff can scan" promise in TEST_ACCOUNTS.md is untrue today.)
  - The organizer console shows Edit, Cancel and Delete to door staff, and the server refuses all three.
  - On the event page, door staff see "I'm in", which fails with "You are organising this event".
- **Fix:**
  - **Server.** Add a door-safe list, `GET /api/events/:id/door-list`, guarded by `findCheckinEvent`. It returns name, avatar, status and `checkedInAt`, and never email. It lets door staff check people in by name when a phone can't scan.
  - **Client, manage page.** Fetch attendees only when `viewer.canManage`. For check-in-only staff, render a "Door mode" view: the scanner, a live "checked in / going" counter, and a name search over the door list.
  - **Client, organizer console.** Show Edit, Cancel and Delete only when `event.viewer.canManage`. Label the button "Door check-in" for door staff.
  - **Client, RSVP button.** When `viewer.canCheckIn && !viewer.canManage`, show a "Door check-in" link instead of "I'm in".
- **Test.** A server test that door staff get the door list (200, no `email` field) and are refused the attendee list (403). A Playwright test signed in as `rahul@` that opens the meetup and sees the scanner.

### B4. A co-organiser can lock the owner out of their own event (P0, security, reproduced)

- **Where:**
  - `server/src/modules/events/staff.routes.ts:19` (`roleBody` accepts `owner`)
  - `staff.service.ts:81-105`
- **Reproduced.** A manager:
  1. PATCHes the owner's team row to `checkin`.
  2. DELETEs that row. `removeStaff` only refuses rows whose *role* is `owner`. The delete also `$pull`s the owner out of `organizers`.
  3. The owner now gets 403 on their own event: `canManage: false`.

  The same manager can also PATCH their own row to `owner`, which makes them impossible to remove.
- **Also wrong.** `invite()` compares `String(invitee._id) === String(event.owner)` at line 54. But `event.owner` is a populated document there, so the comparison is always false.
- **Fix:**
  - `roleBody` accepts `manager | checkin` only.
  - `setStaffRole` and `removeStaff` refuse any row whose `user` is `event.owner`. Decide by user id, not by the row's role.
  - `invite()` uses `event.isOwnedBy(invitee._id)`.
  - Add an explicit owner-only `POST /api/event-staff/:id/transfer-ownership` later, if needed.
- **Test.** Exactly the reproduction above. Every step must now fail, and the owner keeps `canManage: true`.

### B5. Door staff can send announcements that notify and email every attendee (P0, permissions, reproduced)

- **Where:**
  - `server/src/modules/chat/chat.service.ts:44`
  - `events.policy.ts:32-44`, `:58`, `:107`
- **Reproduced.** Door staff POST `{announcement: true}` and get 201. Every attendee gets a notification and an email.
- **Why.** `canManage(user, event)` is called without the staff role. `accessFor` treats any co-organiser with no role passed in as a full manager. The same defaulting decides who may view drafts (line 58) and who may chat (line 107).
- **Fix:**
  - Make it impossible to forget the role. Either make `staffRole` a required argument, or let `accessFor` take a `LoadedEvent`.
  - In chat, use `loadEvent` and `access.canManage`.
  - The default must be the *least* privilege: a co-organiser with an unknown role gets door rights only.
- **Test.** Door staff POSTing an announcement get 403. A normal message from them still works, if we keep that.

### B6. Failed emails are never retried (P0, reproduced)

- **Where:** `server/src/jobs/outbox.ts:83-89`.
- **Reproduced.** After one failed send, `attempts` is 6, because the failure path does `$inc: { attempts: MAX_ATTEMPTS }`. The row is then never picked again. The README says emails are retried "up to five times"; in fact one Brevo timeout loses the email for good.
- **Fix:**
  - The claim already counts the attempt, so the failure path should only clear `claimedAt`.
  - Add `nextAttemptAt` with exponential backoff (1 minute, 5, 30, 2 hours), plus `lastError`, and `failedAt` once `attempts >= MAX_ATTEMPTS`.
  - Treat "email not configured" (when `sendMail` returns false because `env.mail.enabled` is false) separately: don't burn attempts.
  - Change `sendMail` to return `{ ok, retryable, error }` instead of a bare boolean.
  - `pruneOldData` should also delete `failedAt` rows older than 30 days. Today abandoned rows are never pruned.
- **Test.** Make the transport fail twice and then succeed (inject a fake mailer). The email is delivered on the third drain.

### B7. On Vercel, notification emails go out once a day, 25 at a time (P0, production)

> **Update, 6 Nov 2026:** the jobs now run on Vercel Schedules (which replace Cron Jobs), and the outbox drains every 15 minutes even on Hobby. The opportunistic drain and the bigger batches below are still worth doing; the GitHub Actions scheduler no longer is.

- **Where:** `server/vercel.json` (crons) and `outbox.ts:10` (`BATCH_SIZE = 25`).
- **What's wrong.** The outbox is drained only by the daily 07:30 UTC cron, and each run sends at most 25 emails. So a waitlist promotion, a cancellation or an announcement reaches inboxes up to 24 hours later, often after the event. A cancellation to 200 attendees takes 8 days. Event reminders are queued at 07:00 and also capped at 25 a day.
- **Fix, do both:**
  1. **Opportunistic drain.** After a request queues mail, call `waitUntil(drainOutbox())` from `@vercel/functions` on serverless (in-process on long-running hosts). The response stays fast and the mail leaves within seconds.
  2. **A frequent external scheduler** as the safety net. Hobby-plan crons run once a day, so add a GitHub Actions `schedule` workflow (every 5-10 minutes) that calls `/api/jobs/email-outbox` and `/api/jobs/event-reminders` with `CRON_SECRET`. Or move to Vercel Pro.
  3. **Bigger runs.** Let one drain run loop until the queue is empty or about 45 seconds have passed, sending with small concurrency (around 5).
- **Reminder text.** Reminders say "Starts in about N hours", which is wrong by the time the mail arrives. Put the actual start time in the campus time zone (B14) in the email.
- **Test.**
  - A unit test that `drainOutbox` keeps going past 25 until the queue is empty.
  - A test that queuing mail schedules a drain. Abstract `waitUntil` behind `lib/background.ts` so tests can await it.

### B8. A freed seat can skip the waitlist, and on Vercel nobody may be promoted at all (P0)

- **Where:**
  - `server/src/modules/events/registrations.service.ts:25-69`
  - `waitlist.service.ts:52-83`
  - `jobs/maintenance.ts`
- **What's wrong.**
  - `unregister` releases the seat, responds, and only then runs `void fillFromWaitlist(event)`. On serverless the function can be frozen once the response is sent, so the promotion may never run.
  - Even when it does run, there is a gap: a brand-new RSVP calls `claimSeat`, which doesn't check for anyone waiting, and takes the freed seat ahead of the waitlist.
  - The maintenance job recounts seats but never promotes anyone, so the waitlist can stall until someone else leaves.
- **Fix:**
  - **Hand the seat over directly.** When a `going` registration is deleted, `findOneAndUpdate` the oldest `waitlisted` row to `going` first. Release the seat only if nobody was waiting. Send the notifications through `waitUntil` (or simply await them).
  - **No queue-jumping.** In `register`, if `Registration.exists({event, status: waitlisted})`, a new registrant joins the waitlist even when a seat looks free.
  - **Maintenance.** After `recountAttendees`, run `fillFromWaitlist` for upcoming events where `attendeeCount < capacity` and someone is waiting.
- **Test.**
  - Capacity 1: A is going, B is waitlisted. A leaves. B is going *before* the response returns, and a fresh RSVP from C goes to the waitlist.
  - The maintenance test promotes after correcting drift.

### B9. Opening your own private plan or a draft shows "Event not found" (P0)

- **Where:** `client/src/app/events/[id]/page.tsx:36-52, 98-103`.
- **What's wrong.** The server-rendered page fetches the event anonymously. Private plans and drafts are only visible to their owner and organisers, so the fetch 404s and the page calls `notFound()`. Every way in is affected:
  - clicking a personal plan on Schedule (`ScheduleCalendar.tsx:73`);
  - a note linked to a private plan (`NotesBoard.tsx:183`);
  - a draft in the organizer console;
  - the "View" button on the manage page.
- **Fix.** When the anonymous fetch 404s, render `EventDetails` in client-only mode instead of `notFound()`. It fetches with the user's token and shows "Event not found" only if that also fails. Mark that response `robots: { index: false }` so drafts are never indexed. Keep the SSR path for public events, where link previews matter.
- **Test.** A Playwright test: as `member@`, click "Study group" on Schedule and the event page renders. As an anonymous visitor, the same URL shows "Event not found".

### B10. An admin "reviewing" a report cancels the event silently (P0, reproduced)

- **Where:**
  - `server/src/modules/reports/reports.service.ts:80-86`
  - `client/src/components/admin/AdminConsole.tsx:342`
- **Reproduced.** The event becomes `cancelled`, but neither the attendees nor the organiser are told. The admin screen says it "cancels the event and notifies its attendees".
- **Fix:**
  - Pull the body of `events.cancel` out into a shared `cancelEvent(event, { reason, actor })` and call it from both places.
  - Also notify the organiser, with the reason.
  - In the admin UI, put "Mark reviewed" behind a `ConfirmDialog` with an optional reason that is sent to attendees and the organiser.
- **Test.** The reproduction above now creates `event_cancelled` notifications for the attendee and a notification for the owner.

---

## Phase 2: P1 bugs

### B11. An event with RSVPs can be switched back to draft, and it disappears for attendees (reproduced)

- **Where:** `server/src/modules/events/events.service.ts:170-204`.
- **What's wrong.** `PATCH {status:'draft'}` on a published event with registrations returns 200. Attendees then get 404 and are never told.
- **Fix.** Refuse with 400 "This event has registrations; cancel it instead" when registrations exist. While in `update`, also:
  - refuse `status: draft` and `capacity` on private events, matching what `create` enforces;
  - refuse a start time in the past when *publishing*.
- **Test.** One test per refusal.

### B12. Moving an event doesn't re-arm its reminders

- **Where:** `events.service.ts:184-198` and `jobs/eventReminders.ts`.
- **What's wrong.** `reminderSentAt` is not reset when `startsAt` changes. Postpone an event after its reminder has gone out and attendees never get a reminder for the new date.
- **Fix.** When `startsAt` changes, run `Registration.updateMany({event}, {$set:{reminderSentAt:null}})`.
- **Test.** Remind, move the start a week later, run the job again: a second reminder is sent.

### B13. Times are shown in UTC on first load and in link previews

- **Where:**
  - `client/src/lib/format.ts:64-66` (formatters built at module scope with the runtime's time zone)
  - `client/src/app/events/[id]/page.tsx:66` (`timeZone: 'UTC'`)
- **What's wrong.** On Vercel, server rendering happens in UTC. The event page's first HTML shows UTC times; then the browser re-renders in local time, the time visibly jumps, and React logs a hydration mismatch. WhatsApp and Slack previews say "Saturday 4 October at 04:30" for a 10:00 IST event.
- **Fix:**
  - Add `NEXT_PUBLIC_CAMPUS_TIMEZONE` (default `Asia/Kolkata`) and use it for every server-rendered and metadata time.
  - On the client, format in the viewer's zone after mount, adding a zone label when it differs from the campus zone.
  - Pass `timeZone` explicitly in `format.ts`.
  - Store `user.timeZone`, captured from the browser at sign-up or in Settings, for emails and reminders (see B7).
- **Test.** A unit test of `formatEventWhen` with a fixed zone. Check the event page source as served: it should contain the IST time.

### B14. One tap gives up your seat on a phone

- **Where:** `client/src/components/events/RsvpButton.tsx:98-107`.
- **What's wrong.** "You're in" is also the cancel button. The "Cancel plans" label only appears on hover, which phones don't have, so a single tap drops a seat at a full event, and it goes to the waitlist for good.
- **Fix.** Make "You're in" open a small sheet with "Add to calendar", "Show entry code" and a red "Cancel my spot". When the event is full or has a waitlist, the sheet warns "You'll lose your spot to the waitlist."
- **Test.** A Playwright test: tapping "You're in" doesn't unregister.

### B15. Explore has no date filter, though the README promises one

- **Where:** `client/src/app/(app)/explore/page.tsx`. The API already accepts `from` and `to`.
- **Fix:**
  - Add chips: Today, Tomorrow, This weekend, This week, and Pick a date, computed in the campus time zone.
  - Put every filter (search, category, date, sort) into the URL so a filtered view can be shared.
  - Fix "Load more": catch errors, and drop the response if the filters changed while it was loading (lines 64-74).
- **Test.** A Playwright test: "This weekend" sends the right `from`/`to` and the URL updates.

### B16. `javascript:` and `data:` URLs are accepted for links and images (reproduced)

- **Where:** `server/src/lib/schemas.ts:50` (`optionalUrl` uses `z.url()`, which accepts any scheme).
- **What's wrong.** It is used for `onlineUrl`, `coverImageUrl` and `avatarUrl`. React 19 blocks `javascript:` inside `href`, but emails, calendar files and any future client would not.
- **Fix.** Allow only `http` and `https` (zod 4: `z.url({ protocol: /^https?$/ })`). Clean up existing rows in a one-off migration script.
- **Test.** Creating an event with `onlineUrl: 'javascript:alert(1)'` returns 400.

### B17. Password reset and email verification sign in suspended accounts (reproduced)

- **Where:** `server/src/modules/auth/auth.service.ts:88` (`verifyEmail`) and `:151` (`resetPassword`).
- **What's wrong.** Both return a session token without checking `status`.
- **Fix.** Throw `ACCOUNT_SUSPENDED` before `createSession` in both. Also make the client sign out on `403 ACCOUNT_SUSPENDED`; today `client/src/lib/api/client.ts:79` only handles `401 INVALID_TOKEN`, so a user suspended mid-session sees endless errors.
- **Test.** A suspended user's reset returns 403 and no token.

### B18. Leaving a finished event deletes the attendance record (reproduced)

- **Where:** `registrations.service.ts:54-69`.
- **What's wrong.** `DELETE /registration` on a past event returns 200 and destroys the check-in history the organiser's attendance rate depends on.
- **Fix.** Refuse once the event has started (400 "This event has already started"). Refuse if the person is checked in.
- **Test.** Leaving a past event returns 400 and the registration remains.

### B19. Every visitor may share one rate-limit bucket in production (verify first)

- **Where:** `server/src/config/env.ts:28` (`TRUST_PROXY` defaults to 0) and `middleware/rateLimit.ts`.
- **What's wrong.** Unless the Vercel API project sets `TRUST_PROXY=1`, `req.ip` is the proxy's address. Every visitor then shares the 30-per-15-minutes sign-in budget, which a busy demo exhausts at once, and the 300-per-minute API budget. On top of that, the memory store is per serverless instance, so limits are both shared and leaky.
- **Fix:**
  1. Check the Vercel env and set `TRUST_PROXY=1`.
  2. Default `TRUST_PROXY` to 1 when `process.env.VERCEL` is set.
  3. Move the stores to MongoDB (`rate-limit-mongo`) or Upstash, so limits hold across instances.
- **Test.** A test that `req.ip` comes from `X-Forwarded-For` when `TRUST_PROXY=1`.

### B20. Escape in the map picker closes the whole event form

- **Where:** `client/src/components/ui/overlay.tsx:31`.
- **What's wrong.** Each open `Dialog` listens for Escape on `document`, so the nested map dialog and the event form both close and the typed form is lost. A stray click on the backdrop also throws the form away without asking.
- **Fix:**
  - Keep a dialog stack in context so only the top dialog handles Escape.
  - When the form is dirty, ask "Discard this event?" before closing.
  - While in there: trap focus inside the dialog, return focus to the opener on close, and add `aria-labelledby` and `aria-describedby`.
- **Test.** A Playwright test: open the map picker, press Escape, and the form is still open with its data.

### B21. Clash warnings count cancelled events (reproduced)

- **Where:** `server/src/modules/events/waitlist.service.ts:31-38`.
- **Fix.** Add `status: 'published'` to the overlap query.
- **Test.** The reproduction above returns no clashes.

### B22. Possible open redirect after sign-in (verify)

- **Where:** `client/src/app/authentication/page.tsx:29`.
- **What's wrong.** `next=/\evil.com` passes the `startsWith('/') && !startsWith('//')` check, and browsers treat `/\` like `//`.
- **Fix.** `const url = new URL(next, window.location.origin); if (url.origin === window.location.origin) use url.pathname + url.search`.
- **Test.** A unit test of the helper.

---

## Phase 3: P2 bugs, hardening and polish

Group these into one or two PRs.

| ID | Where | Problem | Fix |
|---|---|---|---|
| B23 | `server/src/jobs/maintenance.ts:18-44` | The recount only looks at the first 500 capped events (no sort), aggregates every `going` registration in the database, and writes absolute values that can race a concurrent RSVP. | Only events not yet ended; paginate; write `updateOne({_id, attendeeCount: old}, …)`. |
| B24 | `maintenance.ts:46-66` | Its comment says old chats are pruned; they aren't. | Decide a retention period (for example 180 days after the event) or fix the comment. |
| B25 | `client/src/components/calendar/ScheduleCalendar.tsx:28` | Events you co-organise are coloured "Going". | Use `viewer.isOrganizer`. |
| B26 | `client/src/app/(app)/schedule/page.tsx:16-18` | The entry code doesn't refresh after an RSVP elsewhere. | Depend on `version` from `useEventsSync`. |
| B27 | `client/src/components/chat/EventChat.tsx:70-109` | "Load earlier" has no error handling. Polling with `after: createdAt` and `$gt` can skip messages that share a timestamp. | Catch errors; page by `_id` (ObjectIds sort by time) instead of `createdAt`. |
| B28 | `server/src/modules/events/ratings.service.ts:57, 70-75` | Anyone who RSVPed can rate, even without attending (the README and model say "checked-in attendee"). The summary divides the cached sum by a freshly aggregated count. | Require `checkedInAt` (see open questions), and use one source for both numbers. |
| B29 | `server/src/modules/events/checkin.service.ts:43, 47` | No-permission returns 400 rather than 403. Tickets can be scanned after the event ended or was cancelled. | 403; refuse scans when the event is cancelled or ended more than 6 hours ago. |
| B30 | `events.service.ts:57-80` | "Picked for you" sorts upcoming events by `ratingSum`, which is always 0 before an event happens, so it is really sorted by attendance. Events you help run (not own) can be recommended to you. | Rank by the organiser's past average rating plus attendance plus recency; exclude events where `organizers` contains the user. |
| B31 | `events.service.ts:36` | The `organizer` filter matches only `owner`, not co-organisers. | Match `organizers`. |
| B32 | `server/src/modules/notifications/notifications.service.ts:42-46` | Emails are queued with one insert per recipient, in a loop. Suspended users still get mail. | `insertMany`; filter out `status: suspended`. |
| B33 | `events.service.ts:225-246` | Deleting a past event destroys its history; notifications keep linking to it and 404; the deletes aren't atomic. | Allow delete only for drafts and future events (past events get "archive"); run it in a transaction; delete or redirect the event's notifications. |
| B34 | `server/src/sockets/index.ts` | A socket stays in an event room after its user leaves the event or is suspended. No server-side throttle on typing events. A second API instance breaks fan-out. | Re-check access on a timer or on leave; throttle `event:typing`; plan the `@socket.io/redis-adapter` (or move fully to polling or SSE). |
| B35 | `server/src/modules/assistant/assistant.tools.ts:149` | `name in schemas` accepts prototype keys like `constructor`, which then crash with a 500. | `Object.hasOwn(schemas, name)`. |
| B36 | `auth.service.ts:118-121, 135-149` | Sign-in is faster for unknown emails, which leaks whether an account exists. Forgot-password has no cooldown, so it can be used to flood someone's inbox. | Compare against a dummy bcrypt hash when the user is missing; add a 60-second per-email cooldown on reset emails. |
| B37 | `client/src/components/organizer/EventManagement.tsx:23-36`; `client/src/lib/api/index.ts:141-149` | The CSV export allows formula injection (a name starting with `=`), and Excel garbles non-ASCII names. The `.ics` download revokes its object URL immediately, which breaks in Safari. | Prefix risky cells with `'`; add a UTF-8 BOM; revoke in a `setTimeout`. |
| B38 | `client/src/components/map/usePlaceSearch.ts:12-36` | It can stay stuck on "Searching…" after a cancelled request. | Reset `searching` in the cleanup and in the under-3-characters branch. |
| B39 | `server/src/modules/places/places.service.ts`; `client/src/components/map/VenueMap.tsx:26` | Nothing enforces Nominatim's 1-request-per-second policy across users; there's no campus bias; the default map centre is hard-coded to IIT Kanpur. | A global 1 rps queue; `viewbox` and `countrycodes` from campus config; centre from config. |
| B40 | `client/src/components/shell/nav.ts` | Every member sees "Organizer" and lands on an empty "Run the show" console. | Show it to organisers, admins and anyone with a staff row; give other members a "Host an event" link to the application in Settings. |
| B41 | `client/src/components/chat/ChatWorkspace.tsx:25-38` | Members who staff an event don't see its chat; past events' chats can't be reached. | Include staffed events (add `GET /api/me/staffed`); add a "Past" section. |
| B42 | `server/src/lib/tokens.ts:19`; `checkin.service.ts:47` | `jwt.verify` doesn't pin the algorithm, and tickets share the session secret. | `algorithms: ['HS256']`; sessions get `aud: 'session'`, tickets their own key (see B1). |
| B43 | Several files | Leftover mis-indentation from earlier edits: `server/src/server.ts:30-37`, `registrations.service.ts:49-52, 119-120`, `staff.service.ts:61-64, 104-105`, `events.policy.ts:151-166`, `maintenance.ts:56-63`, `ratings.service.ts:38-44`, `client/src/lib/api/index.ts:125-132, 221-226`, `EventManagement.tsx:206-219`, `RsvpButton.tsx:66-96`, `client/src/app/events/[id]/page.tsx:58-60, 76-79`. Unused: the `sendNow` export and the `Types` import in `registrations.service.ts`. The README test-count badge is hard-coded. | Fix with Prettier (Phase 4); remove dead code; make the badge dynamic or drop it. |
| B44 | `client/src/components/organizer/EventTeam.tsx`, `OrganizerConsole.tsx` | Removing a teammate and deleting an event happen without a confirmation step or an undo. | `ConfirmDialog` for remove; "Undo" toast for role changes. |
| B45 | `client/src/context/AuthContext.tsx` | The token lives in `localStorage` for 7 days with no server-side revocation, so "Sign out" doesn't invalidate it. | Phase 4 E7 (`tokenVersion` on the user, bumped on sign-out-everywhere and password change). |

---

## Phase 4: Engineering foundations

These stop the bugs above from coming back.

- **E1. Web app tests.** There are none today. The build only type-checks.
  - Add Playwright, run against `npm run dev:memory`, covering: demo sign-in; RSVP, cancel and waitlist; create a public event and a private plan; open a private plan from Schedule (B9); door staff reach the scanner (B3); scanner fake-camera test (B2); Explore date filters (B15).
  - Add Vitest for `lib/format.ts`, the QR encode/decode round trip (B1) and the redirect helper (B22).
- **E2. Lint and format.** Nothing is configured, and `next build` no longer runs ESLint in Next 16.
  - Add ESLint (with `eslint-plugin-react-hooks`) and Prettier at the repo root.
  - Add `npm run lint` and `npm run format:check`.
  - Make the PR that adds Prettier contain only the formatting, so later diffs stay readable.
- **E3. One source of truth for shared types.** `client/src/lib/api/types.ts` (293 lines) hand-copies the server's shapes and `constants.ts`. Move constants and the zod request schemas into a small `shared/` package that both import, or generate the client types from the zod schemas. Then a rename on the server breaks the client build instead of the client at runtime.
- **E4. Observability.**
  - Sentry (or similar) on both the Next app and Express; `client/src/app/events/[id]/error.tsx` already has a placeholder.
  - Put pino's request id in the `X-Request-Id` response header.
  - An uptime monitor on `/api/health`.
  - A log line per job run with counts.
- **E5. Background work on serverless.** A `lib/background.ts` helper:
  - uses `waitUntil` on Vercel and runs in-process elsewhere;
  - is used by the outbox (B7), waitlist promotion (B8) and notifications;
  - plus the GitHub Actions scheduler from B7.
- **E6. A shared rate-limit store**, from B19.
- **E7. Security headers and sessions.**
  - A CSP and security headers for the Next app (`next.config.js` `headers()`); the API has helmet, the web app has nothing.
  - Add `tokenVersion` to `User`, put it in the JWT and check it in `resolveUserFromToken`. That gives a real "Sign out of all devices".
  - Later, consider httpOnly cookie sessions with a short-lived access token.
- **E8. Database.**
  - A text index on `title`, `description`, `tags` and `venue.name` for search (or Atlas Search for typo tolerance).
  - A `Registration {user:1, status:1}` index.
  - Transactions for event deletion and seat handover (needs a replica set; `mongodb-memory-server` offers `MongoMemoryReplSet` for tests).
- **E9. CI.**
  - A lint job and a web-test job.
  - Run Playwright against `dev:memory`.
  - Extend `verify-deploy` with the "demo has upcoming events" check (B0) and a check that `/api/health` reports the database up.
- **E10. Accessibility pass.** Run axe in Playwright on every page. Fix focus handling (B20) and keyboard access to the tilt cards and marquee. Check colour contrast in the light theme, especially the neon accents on off-white.

---

## Phase 5: Product roadmap

The core loop works: discover, RSVP, get reminded, show a ticket, get checked in, rate. The biggest wins are making that loop more reliable and more social, and giving organisers the tools a real club committee needs. Items are ordered by value to users against effort.

### Now: high value, builds directly on what exists

1. **Installable app and push notifications.**
   - Why: students live on their phones, email is slow (B7) and often ignored, and today the bell only updates while the app is open.
   - What: a web app manifest and service worker so Sync installs to the home screen; Web Push (VAPID keys and a `PushSubscription` model) for reminders, waitlist promotions, announcements and cancellations; a per-type choice of push, email and in-app.
   - Measure: share of users who allow push; RSVP-to-check-in rate before and after.
2. **Find the right event faster.**
   - Date chips (B15), plus filters for "Has spots", "Online" and "Free food" (a tag chip).
   - Club or organiser search.
   - Filters kept in the URL.
   - Typo-tolerant search (E8).
3. **A calendar that stays in sync by itself.**
   - Each user gets a secret subscription URL (`webcal://…/api/calendar/<token>.ics`) for everything they're going to, which Google, Apple and Outlook Calendar refresh automatically.
   - An "Add to Google Calendar" link next to the `.ics` download.
   - Today's one-off file goes stale the moment an organiser moves the event.
4. **"Interested", separate from "I'm in".** Students bookmark events they might attend. The bookmark gets a gentle reminder, and the count is social proof for organisers ("48 interested").
5. **Club pages and following.**
   - A page at `/clubs/:id` with about text, socials, upcoming and past events and the average rating.
   - A Follow button: followers are notified when that club publishes.
   - Today a club is just a text field on a user, and there is nowhere to see everything a club runs.
6. **A fair, visible waitlist.**
   - Show "You're #3 in line".
   - Offer the seat with a claim window ("Spot open, confirm within 12 hours") instead of silently moving people in who may no longer be free. Unclaimed offers pass to the next person.
   - A "take any seat automatically" toggle for people who want today's behaviour.
   - This cuts no-shows, the number organisers care about most.
7. **Onboarding.** Right after verification, ask for interests and suggest three clubs to follow. Today interests are buried in Settings, and recommendations for new users are just "popular".
8. **A notification centre.** A full page with history and filters (the bell shows 12), and per-type settings (today it's one email on/off switch).
9. **Better sharing.**
   - A per-event Open Graph image generated with `opengraph-image.tsx` (title, date, venue, club), so events without a photo still preview well on WhatsApp.
   - A "Share to WhatsApp" button with pre-filled text.
   - "Invite a friend" from the RSVP sheet.
10. **Better organiser basics.**
    - Upload a cover photo (Vercel Blob or Cloudinary, cropped to 1200×630) instead of pasting a URL.
    - Duplicate an event.
    - Registration opens and closes at set times.
    - Message "going only" or "waitlist only".
    - A "Preview as attendee" toggle.
11. **Door mode**, from B2 and B3, made great:
    - a full-screen scanner that works on iPhone;
    - search by name, for people whose phone died;
    - a live "84 / 120 checked in" counter;
    - offline tolerance: queue scans and sync when back online;
    - sound and vibration on every scan.
12. **Campus-only sign-up.**
    - An `ALLOWED_EMAIL_DOMAINS` setting, for example `iitk.ac.in`, for sign-up or per event ("Campus members only").
    - This is what makes a campus platform trustworthy, and it keeps outsiders off attendee lists.

### Next: bigger features that make Sync the default tool for clubs

1. **Registration questions and approvals.**
   - Custom questions per event: roll number, T-shirt size, dietary needs, team name. The answers go into the CSV export.
   - Optional "organiser approves each RSVP" for selective workshops.
2. **Team registration**, for hackathons and quizzes: create or join a team with a code, minimum and maximum team size, team-level check-in.
3. **Recurring events**, such as a weekly club meetup: RSVP to one date or the whole series.
4. **Organiser analytics.** A funnel of page views, RSVPs and check-ins; registrations over time; no-show rate; rating trend; where RSVPs came from (shared link, Explore or a recommendation).
5. **After the event.**
   - A short feedback form beyond the stars.
   - A link to the photo album.
   - An automatic participation certificate (PDF) for checked-in attendees, something Indian campuses ask for constantly.
   - A "My events" history page.
6. **Richer chat.**
   - Replies, reactions, pinned organiser messages, @mentions, an unread badge per chat, and mute.
   - For moderation, organisers can delete messages, members can report them, and the reports go to the admin queue. Today nobody can remove an abusive message.
7. **Friends.** Opt-in "friends going" on event cards, "going with" and invites. Seeing friends attend is the strongest driver of RSVPs.
8. **Venues and room clashes.**
   - An admin-curated venue list with coordinates, capacity and accessibility notes.
   - Warn organisers when two events book the same room at the same time, a real campus pain.
   - Replace the static OpenStreetMap iframe with an interactive map (Leaflet or MapLibre) that shows every venue pin and lets organisers click to drop one.
9. **Admin tools.**
   - An audit log of admin actions.
   - A takedown reason sent to the organiser.
   - A queue for reported chat messages.
   - Platform charts: weekly RSVPs, active clubs, new users.
   - Optional review before a new organiser's first event is published.
   - A ban reason, and an appeal note.
10. **Clubs as real entities.** A club has members with roles (president, core team, volunteers), and its events belong to the club, so the committee gets access automatically instead of being invited event by event. The organiser application becomes "register your club".
11. **Ask Sync can act, with confirmation.** "RSVP me to the Rust workshop" shows a confirm card that calls the normal API. Also "Plan my weekend" and "Remind me an hour before". Today it can only read.
12. **Account and privacy.**
    - Delete my account and export my data (India's DPDP Act 2023 expects both).
    - Change email.
    - A list of active sessions with "sign out everywhere" (E7).
    - A time zone setting.
    - Privacy policy and terms pages.

### Later: strategic bets

1. **Paid tickets and fest passes** through Razorpay or UPI, with ticket tiers, refunds and payouts to clubs.
2. **More than one campus.** A campus configuration (name, time zone, map centre, email domains, categories), then several campuses per deployment and inter-college events.
3. **Native shell** (Capacitor) with Apple and Google Wallet passes for tickets.
4. **Languages:** Hindi first, then regional languages.
5. **Integrations:** two-way Google Calendar; a bot that posts new events to a club's WhatsApp community or Discord; an Instagram story card for each event.
6. **Club operations:** volunteer shifts, sponsor pages, budgets.

### What to measure

Add privacy-respecting product analytics (PostHog or Plausible) and track:

- activation: first RSVP within 7 days of sign-up;
- RSVP-to-check-in rate, overall and per club;
- weekly active students;
- organisers who publish again within 30 days;
- push and email opt-in rates;
- how long the waitlist takes to fill a freed seat.

---

## PR plan (suggested order)

| # | PR | Covers | Notes |
|---|---|---|---|
| 1 | Demo mode and daily reset | B0, E9 (demo check) | Needs the scheduling decision (open question 1). |
| 2 | Permissions and moderation | B4, B5, B10, B11, B16, B17, B18, B21, B3 (server door list) | Server, plus the admin confirm dialog for B10; all with tests. |
| 3 | Seats and waitlist | B8, B23 | Server only, with tests. |
| 4 | Email and jobs pipeline | B6, B7, B12, B24, E5 | Adds `lib/background.ts` and the GitHub Actions scheduler. |
| 5 | Tickets and door mode | B1, B2, B3 (client), B42 | Client and server; test on a real iPhone and Android phone. |
| 6 | Event page and time zones | B9, B13 | Adds `NEXT_PUBLIC_CAMPUS_TIMEZONE`. |
| 7 | Web app UX fixes | B14, B15, B20, B22, B25-B27, B37, B38, B40, B41, B44, B17 (client part) | Add Playwright (E1) in this PR or just before it. |
| 8 | Remaining P2 | B19, B28-B36, B39, B45 | B19 starts with checking the Vercel env. |
| 9 | Tooling | E2 (Prettier-only commit first, then ESLint), B43, E3, E4, E7, E8, E10 | Can run in parallel with 2-8 if they touch different files. |
| 10+ | Roadmap | Phase 5, "Now" items one per PR, starting with push notifications and date filters | |

After each PR, update README and TEST_ACCOUNTS where behaviour changed.

---

## Open questions for the owner

The agent should use the defaults in brackets and flag them in the PR.

1. **Is the Vercel API on the Hobby plan?** If so, crons can only run daily, which is why B7 proposes `waitUntil` plus a GitHub Actions scheduler. [Assume Hobby.]
2. **Is `TRUST_PROXY=1` set on the Vercel API project?** (B19) [Check; set it if missing.]
3. **What is the campus time zone and default map centre?** [`Asia/Kolkata`; keep the IIT Kanpur coordinates as the default, but make them configurable.]
4. **Should only checked-in attendees be able to rate?** (B28) [Yes: that's what the README and the model say.]
5. **May co-organisers delete an event or manage the team, or only the owner?** [Managers may edit and manage door staff. Only the owner may delete, or add and remove managers.]
6. **Should "Mark reviewed" on a report cancel the event, or hide it until the organiser responds?** (B10) [Keep cancel, with a confirmation and notifications.]
7. **Should the live demo stay public and writable?** (B0) [Yes, with demo mode protections and a nightly reset.]
8. **Is the app restricted to one college's email domain?** (Now #12) [Not by default; make it configurable.]
