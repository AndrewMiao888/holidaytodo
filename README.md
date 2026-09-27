# Your Habit Tracker - Nuxt 4

A personal holiday habit tracker with a separate customisation route, built with Nuxt 4 and Vue 3. The interface uses Vue components and a reactive composable; the data model and backup validation are standalone ES modules.

## Run it

Use Node.js 22 or newer (Node 24 recommended).

```sh
npm install
npm run dev
```

Open http://localhost:3000 for the original 16-day holiday routine. `app/app.vue` renders Nuxt pages: `app/pages/index.vue` is the normal tracker, and `app/pages/custom.vue` provides customisation at `/custom`. The routes share `app/components/TrackerDashboard.vue` and the saved tracker state. The main page includes Reset All and the full appearance chooser. There are no links or buttons to `/custom`; enter that path manually for testing or development. `index.html` is now a small export bridge for old saved progress, not the application entry point.

```sh
npm test          # model, backups, Vue editor, and controller checks
npm run build    # production Node server in .output/
npm run preview  # preview the production build
npm run generate # optional static output in .output/public/
```

Nuxt runs in client-rendered mode because progress belongs in the user's browser. No account or backend is required. Styling is local; the optional Inter font loads from Google Fonts and falls back to a system font.

## Make it yours

Type http://localhost:3000/custom in the address bar to access **Customise routine** and backup restore. **Appearance** is also available directly on the main page. Editing controls, starter packs, and setup imports are only rendered on that route. Changes are saved to the same tracker and are reflected on `/`.

The default is the original September 27 to October 12, 2026 routine: the two-hour Myobrace timer; two weekday exam sessions; bend-down, jump-up, and 1 km run checkboxes; five flute tasks; four piano pieces; and the paired daily routines. It uses the original pastel/time-of-day backgrounds, colourful heading and animated border. The earlier empty generic default upgrades once, preserving appearance and keeping its prior data under `holiday_habit_tracker_v5_before_personal_default`. Existing deliberately customised routines remain saved.

On `/custom`, change the challenge name, start date, and length (1-366 days), or archive the default habits and build a new routine.

- Add simple checkboxes, checklists, number goals (including decimals), and timers.
- Edit names, icons, categories, notes, card colours, targets, units, checklist steps, and the weekdays each habit appears.
- Reorder habits and checklist steps, duplicate them, or archive and restore habits. Archived habits and removed checklist steps keep their underlying historical records.
- Write your own motivational messages with `{habit}`, `{item}`, `{target}`, and `{unit}` placeholders, or use automatic, task-specific congratulations that name the exact completed goal and rotate between messages. Timer message targets use minutes.
- Save changes explicitly or cancel the editor without changing the live routine. Editing names or order keeps stable task identities. Current progress and appearance are preserved if they change while the editor is open.

Select **Appearance** or expand **Choose your background** on either page for 20 preset gradients or a custom three-colour gradient with adjustable direction, accent colour, automatic/light/dark cards, three font choices, compact spacing, animations, and motivational popups. These settings save automatically. Reduced-motion preferences are respected.

The header includes **Reset All**, which confirms before clearing challenge progress and keeps your routine and appearance. The dashboard includes a Today shortcut, daily and overall progress, a best completion streak, and focus view for unfinished tasks. Checklist items count individually; number goals and timers count once. Rest days have no required tasks and break the full-day streak.

## Progress, timers, and backups

Progress is stored by calendar date and stable habit/item IDs. Changing the challenge date range keeps data outside that range, so it reappears if you return to those dates. Changing schedules and targets recalculates displayed totals across the challenge. Archive an existing habit and create a new one if you want a different tracking style without changing the old setup.

Timers use persisted finish times. Switching days, backgrounding the browser, refreshing, or reopening the app does not restart a running timer. Completion becomes visible when the page runs again. Existing timer sessions retain their duration when the target is edited; reset a timer to use its new target. Changing a habit from another style to timer starts fresh timer sessions. Archiving a timer hides it from the routine while its saved session continues.

**Backups & progress** downloads the complete configuration, appearance, progress, and timers. Restore is available on `/custom` and validates the JSON (up to 5 MB) before asking to replace current data. Old 16-day backups are supported. Browser storage is local to each browser and address; download a backup before clearing data or moving devices.

### Upgrading from the old HTML tracker

On the same browser address, existing `holiday_habit_tracker_v4` data automatically migrates, preserving all old tasks, dates, completed items, laps, and timer deadlines. The old key is retained. The new app saves one versioned `holiday_habit_tracker_v5` record.

If your old tracker used a different address or opened as a file, open the original `index.html` path in the original browser and select **Export saved progress**. Start Nuxt, visit `/custom`, then restore that file through **Backups & progress**. Browsers do not share local storage between file URLs, localhost ports, or domains, so changing addresses requires this explicit transfer.

## Project layout

- `app/pages/` - personal home page and directly accessed customisation page.
- `shared/personal-default.mjs` - the original personal routine and progress-preserving adoption.
- `app/components/` - dashboard, habit cards, appearance controls, routine editor.
- `app/composables/useTracker.js` - reactive state, storage, timers, appearance, and interactions.
- `app/assets/tracker.css` - responsive styles and theme variables.
- `shared/tracker-model.mjs` - validated schema, schedules, totals, migrations, and timer calculations.
- `shared/tracker-backup.mjs` - versioned export/import validation.
- `shared/tracker-themes.mjs` - built-in gradient choices.
- `tests/` - dependency-light Node tests, including actual compiled Vue editor behaviour.
