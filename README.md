# Holiday Habit Tracker

A browser-based tracker for September 27 to October 12, 2026. Open `index.html`, keeping `tracker-backup.js` in the same folder. Tailwind styling and the Inter font load from the internet.

- Opens the current challenge day, with a **Go to today** shortcut and a Today marker. Outside the challenge dates, all days remain available for review.
- Shows total tasks completed, the longest streak of consecutive fully completed days, and tasks left on the selected day. Weekend totals exclude exam questions.
- **Focus view** hides checked tasks, including individual flute and piano items. Turn it off to review or uncheck them. The preference is saved on this browser.
- The Myobrace timer uses a saved finish time, so elapsed time is counted across day switches, background tabs, and reopening the page. Completion is shown when the page can run again.
- Includes task-specific motivational messages and 20 selectable gradients, plus an automatic time-of-day background.
- **Back up your progress** at the bottom downloads all 16 days and your background choice as JSON. Restore validates the file and asks before replacing current progress. A running timer retains its original finish time when restored. Focus view is a local preference and is not included in backups.

Progress is stored in this browser's local storage, so downloading a backup is useful before clearing browser data or changing devices.

Run the logic checks with Node.js (no packages required):

```sh
node --test tests/*.test.cjs
```
