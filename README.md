# Daybook — a daily money plan

A small, fast, offline-friendly expense tracker. Set a monthly budget and the
day it resets, and Daybook works out exactly how much you can spend **today**
— recalculating automatically as you log expenses, so overspending one day
quietly tightens the plan for the rest of the cycle (and underspending loosens it).

No backend, no build step, no account. Everything lives in your browser's
`localStorage`, on your device only.

## Files

```
index.html   — structure
style.css    — all styling, light + dark themes, animations
app.js       — all logic: storage, date/cycle math, rendering, modals
```

That's it — three files, no dependencies to install, no bundler.

## Run it locally

Just open `index.html` in a browser. Everything works from the local
filesystem (`file://`), since `localStorage` doesn't require a server.

If you'd rather serve it (some browsers are picky about `file://` + fonts):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Push these three files to the root of a GitHub repository (or to a `/docs`
   folder, or a `gh-pages` branch — your choice).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set the source to the branch/folder you used.
4. Save. GitHub will give you a URL like
   `https://<username>.github.io/<repo>/` within a minute or two.

No further configuration needed — there's nothing to build.

## How the daily allowance is calculated

- **Cycle bounds**: based on the reset day you set (e.g. the 25th), today's
  date is placed inside a billing cycle that runs from one reset day up to
  (but not including) the next. If a month is shorter than your reset day
  (e.g. you set 31 but it's February), Daybook uses that month's last day
  instead.
- **Today's plan** = (budget − amount spent *before* today this cycle) ÷
  (days left in the cycle, including today).
- **Left to spend today** = today's plan − what you've already logged today.
  If you spend more than planned, this can go negative — the app will tell
  you, but won't show a negative hero number (spending below zero isn't
  meaningful).
- **Tomorrow's pace** = (budget − everything spent this cycle so far) ÷
  (days left after today). This is what recalculates live, in front of you,
  the moment you add or edit an expense — it's the clearest way to see the
  "spend more today, less tomorrow" effect the app is built around.
- On the **last day** of a cycle, "tomorrow's pace" instead shows the first
  day's allowance of the *next* cycle (same budget, divided across however
  many days that next cycle has).

## Data & privacy

Two `localStorage` keys are used: `daybook.settings.v1` and
`daybook.expenses.v1`. Nothing is sent anywhere. Clearing your browser data
for the site (or using "Reset all data" in Settings) erases it permanently —
there's no cloud backup, by design.

## Browser support

Built with standard, widely-supported CSS and JavaScript (CSS custom
properties, `:has()`, `Intl.NumberFormat`, `localStorage`). Works on current
versions of Chrome, Safari, Firefox, and Edge, including mobile browsers.
`prefers-reduced-motion` and `prefers-color-scheme` are both respected.
