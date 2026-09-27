const assert = require('node:assert/strict');
const test = require('node:test');
let Model;
test.before(async () => { Model = (await import('../shared/tracker-model.mjs')).default; });

process.env.TZ = 'Australia/Adelaide';

function fixture() {
    const data = Model.createDefaultData(new Date(2026, 8, 27, 12));
    data.challenge.days = 16;
    return data;
}

function addHabit(data, type, properties = {}) {
    const habit = Object.assign(Model.createHabit(type), properties);
    data.habits.push(habit);
    return habit;
}

function legacyDay(complete = false) {
    return {
        myobrace: complete, myobraceSecondsLeft: complete ? 0 : 7200,
        myobraceRunning: false, myobraceEndsAt: null, myobraceLaps: [],
        exam1: complete, exam2: complete, bendDown: complete, jumpUp: complete,
        piano: Array(4).fill(complete), flute: Array(5).fill(complete), run: complete,
        shineEyes1: complete, shineEyes2: complete, vitamin1: complete, vitamin2: complete,
        brushTeeth1: complete, brushTeeth2: complete, probiotic1: complete, probiotic2: complete
    };
}

function legacyFixture() {
    return Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 1, legacyDay()]));
}

test('the blank model factory supports custom setups with complete editable preferences', () => {
    const data = Model.createDefaultData(new Date(2026, 9, 4, 0, 1));
    assert.deepEqual(data.challenge, { name: 'My Habit Tracker', startDate: '2026-10-04', days: 14 });
    assert.deepEqual(data.habits, []);
    assert.deepEqual(data.progress, {});
    assert.deepEqual(Model.validateData(data), data);
    assert.equal(Model.STORAGE_KEY, 'holiday_habit_tracker_v5');
    assert.equal(Model.getSummary(data).total, 0);
});

test('model provides default and named ESM exports without global side effects', async () => {
    const named = await import('../shared/tracker-model.mjs');
    assert.equal(named.validateData, Model.validateData);
    assert.equal(named.createHabit, Model.createHabit);
    assert.equal(globalThis.TrackerModel, undefined);
});

test('habit factories provide every editable field and unique stable safe identifiers', () => {
    const data = fixture();
    for (const type of ['check', 'checklist', 'counter', 'timer']) addHabit(data, type);
    assert.equal(Model.validateData(data).habits.length, 4);
    assert.equal(data.habits[1].items.length, 1);
    assert.equal(data.habits[3].target, 1500);
    const ids = Array.from({ length: 1000 }, () => Model.uid());
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => /^[a-zA-Z0-9_-]{1,80}$/.test(id)));
    assert.throws(() => Model.createHabit('unknown'));
});

test('local date helpers preserve all day boundaries and years below 100', () => {
    for (const key of ['0001-01-01', '0099-12-31', '2000-02-29', '2026-10-04', '9999-12-31']) {
        const date = Model.parseDate(key);
        assert.equal(date.getHours(), 12);
        assert.equal(Model.dateKey(date), key);
    }
    assert.equal(Model.dateKey(new Date(2026, 8, 27, 0, 0)), '2026-09-27');
    assert.equal(Model.dateKey(new Date(2026, 8, 27, 23, 59)), '2026-09-27');
    for (const key of ['2026-02-29', '2026-13-01', '2026-00-01', '2026-04-31', '0000-01-01', '2026-1-01', '2026-10-04T00:00:00Z', '__proto__']) {
        assert.throws(() => Model.parseDate(key), key);
    }
    assert.throws(() => Model.dateKey(new Date(NaN)));
});

test('custom calendars advance through DST, leap days, and year boundaries without drift', () => {
    const data = fixture();
    const days = Model.calendar(data);
    assert.equal(days.length, 16);
    assert.equal(days[0].key, '2026-09-27');
    assert.equal(days[15].key, '2026-10-12');
    assert.deepEqual(days.map(day => day.dayNum), Array.from({ length: 16 }, (_, i) => i + 1));
    assert.equal(days[6].date.getTimezoneOffset(), -570);
    assert.equal(days[7].date.getTimezoneOffset(), -630);
    assert.equal(days[7].date - days[6].date, 23 * 60 * 60 * 1000);
    data.challenge = { name: 'Leap year', startDate: '2028-02-28', days: 3 };
    assert.deepEqual(Model.calendar(data).map(day => day.key), ['2028-02-28', '2028-02-29', '2028-03-01']);
    data.challenge.startDate = '2026-12-31';
    assert.deepEqual(Model.calendar(data).map(day => day.key), ['2026-12-31', '2027-01-01', '2027-01-02']);
});

test('weekly schedules and archived habits control which days count', () => {
    const habit = Model.createHabit();
    habit.weekdays = [1, 3, 5];
    assert.equal(Model.isScheduled(habit, '2026-09-27'), false);
    assert.equal(Model.isScheduled(habit, '2026-09-28'), true);
    assert.equal(Model.isScheduled(habit, '2026-09-29'), false);
    habit.archived = true;
    assert.equal(Model.isScheduled(habit, '2026-09-28'), false);
    habit.archived = false;
    habit.weekdays = [];
    assert.equal(Model.isScheduled(habit, '2026-09-28'), false);
});

test('dynamic totals count checklist children and each check, counter, or timer once', () => {
    const data = fixture();
    const key = '2026-09-28';
    const check = addHabit(data, 'check');
    const list = addHabit(data, 'checklist', { items: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] });
    const counter = addHabit(data, 'counter', { target: 2.5, unit: 'km' });
    const timer = addHabit(data, 'timer');
    Model.record(data, key, check).done = true;
    Model.record(data, key, list).items.first = true;
    Model.record(data, key, counter).count = 2.49;
    Model.record(data, key, timer).done = true;
    assert.deepEqual(Model.getDayStats(data, key), { completed: 3, total: 5, percentage: 60 });
    Model.record(data, key, counter).count = 2.5;
    assert.deepEqual(Model.getDayStats(data, key), { completed: 4, total: 5, percentage: 80 });
    list.items.push({ id: 'third', label: 'Third' });
    assert.equal(Model.getDayStats(data, key).total, 6);
    counter.target = 3;
    assert.equal(Model.getDayStats(data, key).completed, 3);
    list.archived = true;
    assert.deepEqual(Model.getDayStats(data, key), { completed: 2, total: 3, percentage: 67 });
});

test('statistics never create records or discard history on unselected dates', () => {
    const data = fixture();
    const habit = addHabit(data, 'check');
    Model.record(data, '2025-12-01', habit).done = true;
    const before = JSON.stringify(data);
    Model.getDayStats(data, '2026-09-27');
    Model.getSummary(data);
    assert.equal(JSON.stringify(data), before);
    assert.deepEqual(Object.keys(data.progress), ['2025-12-01']);
});

test('rest days have zero percent, cannot be completed, and break full-day streaks', () => {
    const data = fixture();
    data.challenge = { name: 'Week', startDate: '2026-09-28', days: 7 };
    const habit = addHabit(data, 'check', { weekdays: [1, 2, 4, 5, 6] });
    for (const day of Model.calendar(data)) Model.record(data, day.key, habit).done = true;
    assert.deepEqual(Model.getDayStats(data, '2026-09-30'), { completed: 0, total: 0, percentage: 0 });
    assert.deepEqual(Model.getSummary(data), { completed: 5, total: 5, daysCompleted: 5, bestStreak: 3 });
    Model.record(data, '2026-10-02', habit).done = false;
    assert.deepEqual(Model.getSummary(data), { completed: 4, total: 5, daysCompleted: 4, bestStreak: 2 });
});

test('record creation is lazy and editing targets or checklist contents preserves history', () => {
    const data = fixture();
    const habit = addHabit(data, 'timer', { target: 7200 });
    const entry = Model.record(data, '2026-09-27', habit);
    entry.timer.remaining = 3600;
    entry.timer.laps.push(1800);
    entry.items.old_item = true;
    habit.target = 300;
    assert.equal(Model.record(data, '2026-09-27', habit), entry);
    assert.equal(entry.timer.duration, 7200);
    assert.equal(entry.timer.remaining, 3600);
    assert.deepEqual(entry.timer.laps, [1800]);
    assert.equal(Model.record(data, '2026-09-28', habit).timer.duration, 300);
    assert.equal(entry.items.old_item, true);
    assert.throws(() => Model.record(data, 'not-a-date', habit));
});

test('calendar changes preserve out-of-range progress and summary only includes current dates', () => {
    const data = fixture();
    const habit = addHabit(data, 'check');
    Model.record(data, '2026-09-27', habit).done = true;
    data.challenge.startDate = '2027-01-01';
    data.challenge.days = 1;
    const normalized = Model.validateData(data);
    assert.equal(normalized.progress['2026-09-27'][habit.id].done, true);
    assert.deepEqual(Model.getSummary(normalized), { completed: 0, total: 1, daysCompleted: 0, bestStreak: 0 });
    normalized.challenge.startDate = '2026-09-27';
    assert.equal(Model.getSummary(normalized).completed, 1);
});

test('wall-clock timers account for backgrounding and emit each completion only once', () => {
    const data = fixture();
    const habit = addHabit(data, 'timer', { target: 90 });
    const entry = Model.record(data, '2026-09-27', habit);
    const now = Date.UTC(2026, 8, 27);
    entry.timer.running = true;
    entry.timer.endsAt = now + 90_000;
    assert.deepEqual(Model.syncTimers(data, now + 30_001), []);
    assert.equal(entry.timer.remaining, 60);
    assert.equal(entry.done, false);
    const reloaded = Model.validateData(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(Model.syncTimers(reloaded, now + 300_000), [{ dateKey: '2026-09-27', habitId: habit.id }]);
    const restored = reloaded.progress['2026-09-27'][habit.id];
    assert.equal(restored.timer.remaining, 0);
    assert.equal(restored.timer.running, false);
    assert.equal(restored.timer.endsAt, null);
    assert.equal(restored.done, true);
    assert.deepEqual(Model.syncTimers(reloaded, now + 600_000), []);
});

test('timers continue for archived, unscheduled, hidden dates and historical habits', () => {
    const data = fixture();
    const habit = addHabit(data, 'timer', { archived: true, weekdays: [], target: 120 });
    const now = Date.UTC(2026, 8, 27);
    for (const key of ['2025-01-01', '2027-01-01']) {
        const entry = Model.record(data, key, habit);
        entry.timer.running = true;
        entry.timer.endsAt = now + 120_000;
    }
    data.habits = [];
    assert.equal(Model.validateData(data).progress['2025-01-01'][habit.id].timer.running, true);
    assert.equal(Model.syncTimers(data, now + 121_000).length, 2);
    assert.equal(Model.getSummary(data).completed, 0);
    assert.equal(data.progress['2027-01-01'][habit.id].done, true);
});

test('paused timers stay paused and a changed device clock cannot exceed saved duration', () => {
    const data = fixture();
    const habit = addHabit(data, 'timer', { target: 60 });
    const paused = Model.record(data, '2026-09-27', habit);
    paused.timer.remaining = 40;
    const running = Model.record(data, '2026-09-28', habit);
    running.timer.running = true;
    running.timer.endsAt = 1_000_000;
    assert.deepEqual(Model.syncTimers(data, 100), []);
    assert.equal(paused.timer.remaining, 40);
    assert.equal(running.timer.remaining, 60);
    assert.equal(running.timer.endsAt, 1_000_000);
    assert.throws(() => Model.syncTimers(data, NaN));
});

test('legacy migration keeps every original task, date, target, and weekend rule', () => {
    const old = legacyFixture();
    for (let day = 1; day <= 16; day++) {
        for (const [index, field] of ['myobrace', 'exam1', 'exam2', 'bendDown', 'jumpUp', 'run', 'shineEyes1', 'shineEyes2', 'vitamin1', 'vitamin2', 'brushTeeth1', 'brushTeeth2', 'probiotic1', 'probiotic2'].entries()) {
            old[day][field] = (day + index) % 3 === 0;
        }
        old[day].myobraceSecondsLeft = old[day].myobrace ? 0 : 7200;
        old[day].flute = [0, 1, 2, 3, 4].map(index => (day + index) % 2 === 0);
        old[day].piano = [0, 1, 2, 3].map(index => (day + index) % 2 !== 0);
    }
    const before = JSON.stringify(old);
    const data = Model.migrateLegacy(old, 'peach-sky', true);
    assert.deepEqual(data.challenge, { name: 'Holiday Habit Tracker', startDate: '2026-09-27', days: 16 });
    assert.equal(data.preferences.background, 'peach-sky');
    assert.equal(data.preferences.focus, true);
    assert.equal(data.habits.length, 11);
    for (const day of Model.calendar(data)) {
        const legacy = old[day.dayNum];
        const saved = data.progress[day.key];
        assert.equal(saved.myobrace.done, legacy.myobrace);
        assert.equal(saved.bendDown.count, legacy.bendDown ? 20 : 0);
        assert.equal(saved.jumpUp.count, legacy.jumpUp ? 40 : 0);
        assert.equal(saved.run.count, legacy.run ? 1 : 0);
        assert.deepEqual(Object.values(saved.flute.items), legacy.flute);
        assert.deepEqual(Object.values(saved.piano.items), legacy.piano);
        assert.deepEqual(Object.values(saved.exam.items), [legacy.exam1, legacy.exam2]);
        for (const key of ['shineEyes', 'vitamin', 'brushTeeth', 'probiotic']) {
            assert.deepEqual(Object.values(saved[key].items), [legacy[`${key}1`], legacy[`${key}2`]]);
        }
    }
    assert.equal(Model.getDayStats(data, '2026-09-27').total, 21);
    assert.equal(Model.getDayStats(data, '2026-09-28').total, 23);
    assert.equal(Model.getSummary(data).total, 358);
    assert.equal(JSON.stringify(old), before, 'migration must not mutate its input');
});

test('legacy boolean flute marks all five items and complete days stay complete', () => {
    const old = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 1, legacyDay(true)]));
    old[1].flute = true;
    const data = Model.migrateLegacy(old);
    assert.deepEqual(Object.values(data.progress['2026-09-27'].flute.items), Array(5).fill(true));
    assert.deepEqual(Model.getSummary(data), { completed: 358, total: 358, daysCompleted: 16, bestStreak: 16 });
});

test('legacy running timers preserve deadlines and laps, including already expired deadlines', () => {
    const old = legacyFixture();
    const now = Date.UTC(2026, 8, 27);
    old[1].myobraceRunning = true;
    old[1].myobraceSecondsLeft = 500;
    old[1].myobraceEndsAt = now + 300_000;
    old[1].myobraceLaps = [30, 90, 120];
    old[2].myobraceRunning = true;
    old[2].myobraceEndsAt = now - 1000;
    old[2].myobraceSecondsLeft = 100;
    const data = Model.migrateLegacy(old, 'auto', false, now);
    const running = data.progress['2026-09-27'].myobrace;
    assert.deepEqual(running.timer, { duration: 7200, remaining: 300, running: true, endsAt: now + 300_000, laps: [30, 90, 120] });
    const expired = data.progress['2026-09-28'].myobrace;
    assert.equal(expired.done, true);
    assert.equal(expired.timer.remaining, 0);
    assert.equal(expired.timer.endsAt, null);
    assert.equal(expired.timer.running, false);
});

test('legacy timers missing a deadline use their migration reference time', () => {
    const old = { 1: legacyDay() };
    const exportedAt = Date.UTC(2026, 8, 27);
    old[1].myobraceRunning = true;
    old[1].myobraceSecondsLeft = 100;
    delete old[1].myobraceEndsAt;
    const data = Model.migrateLegacy(old, 'auto', false, exportedAt);
    assert.equal(data.progress['2026-09-27'].myobrace.timer.endsAt, exportedAt + 100_000);
    assert.equal(Model.syncTimers(data, exportedAt + 150_000).length, 1);
});

test('malformed legacy values fail instead of silently losing progress', () => {
    const changes = [
        source => { source[1].exam1 = 'true'; },
        source => { source[1].piano.push(false); },
        source => { source[1].flute = [false]; },
        source => { source[1].myobraceSecondsLeft = -1; },
        source => { source[1].myobraceLaps = [7201]; },
        source => { source[1].myobraceRunning = true; source[1].myobraceEndsAt = 'tomorrow'; },
        source => { source[1].myobrace = true; },
        source => { source[1].myobraceEndsAt = 1234; },
        source => { source[17] = legacyDay(); }
    ];
    for (const change of changes) { const source = legacyFixture(); change(source); assert.throws(() => Model.migrateLegacy(source)); }
    assert.throws(() => Model.migrateLegacy({}));
    assert.throws(() => Model.migrateLegacy(null));
});

test('validation clones all allowed fields and removes unknown fields without executing text', () => {
    const data = fixture();
    const habit = addHabit(data, 'checklist', { name: '<img src=x onerror=alert(1)>', messages: ['{habit} {item} {target} {unit}'] });
    const entry = Model.record(data, '2025-01-01', habit);
    entry.items.retired_item = true;
    data.extra = 'ignore me';
    habit.onclick = 'alert(1)';
    entry.html = '<script>bad()</script>';
    entry.timer.noise = true;
    const clean = Model.validateData(data);
    assert.equal(clean.extra, undefined);
    assert.equal(clean.habits[0].onclick, undefined);
    assert.equal(clean.progress['2025-01-01'][habit.id].html, undefined);
    assert.equal(clean.progress['2025-01-01'][habit.id].timer.noise, undefined);
    assert.equal(clean.habits[0].name, habit.name, 'UI must render user strings as text');
    assert.equal(clean.progress['2025-01-01'][habit.id].items.retired_item, true);
    clean.habits[0].items[0].label = 'Edited';
    clean.preferences.customColors[0] = '#000000';
    clean.progress['2025-01-01'][habit.id].items.retired_item = false;
    assert.equal(habit.items[0].label, 'First step');
    assert.equal(data.preferences.customColors[0], '#ffedd5');
    assert.equal(entry.items.retired_item, true);
});

test('validation rejects identifier collisions and prototype-related keys', () => {
    const data = fixture();
    const habit = addHabit(data, 'checklist');
    for (const unsafe of ['__proto__', 'constructor', 'prototype', 'id with spaces', 'x'.repeat(81), 'x" onclick="bad']) {
        const invalid = structuredClone(data);
        invalid.habits[0].id = unsafe;
        assert.throws(() => Model.validateData(invalid), unsafe);
    }
    const duplicates = structuredClone(data);
    duplicates.habits.push(structuredClone(habit));
    assert.throws(() => Model.validateData(duplicates));
    duplicates.habits.pop();
    duplicates.habits[0].items.push(structuredClone(habit.items[0]));
    assert.throws(() => Model.validateData(duplicates));
    const polluted = structuredClone(data);
    polluted.progress['2026-09-27'] = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.throws(() => Model.validateData(polluted));
    assert.equal({}.polluted, undefined);
    assert.throws(() => Model.validateData(Object.create({ version: 5 })));
});

test('validation bounds settings, user strings, schedules, numerical targets and collections', () => {
    const invalidChanges = [
        data => { data.version = 6; },
        data => { data.challenge.name = ''; },
        data => { data.challenge.name = 'a'.repeat(101); },
        data => { data.challenge.days = 367; },
        data => { data.challenge.days = 1.5; },
        data => { data.challenge.startDate = '2026-02-30'; },
        data => { data.challenge.startDate = '9999-12-31'; },
        data => { data.habits[0].type = 'script'; },
        data => { data.habits[0].name = 'a'.repeat(101); },
        data => { data.habits[0].description = '\u0000'; },
        data => { data.habits[0].icon = 'a'.repeat(25); },
        data => { data.habits[0].items = []; },
        data => { data.habits[0].weekdays = [1, 1]; },
        data => { data.habits[0].weekdays = [7]; },
        data => { data.habits[0].messages = ['a'.repeat(501)]; },
        data => { data.habits[0].target = 0; },
        data => { data.habits[0].target = Infinity; },
        data => { data.habits[0].color = 'url(javascript:bad)'; },
        data => { data.preferences.customColors = ['#ffffff']; },
        data => { data.preferences.gradientAngle = 361; },
        data => { data.preferences.mode = 'contrast'; },
        data => { data.preferences.font = 'url(bad)'; },
        data => { data.preferences.focus = 'true'; },
        data => { data.preferences.accent = '#abc'; }
    ];
    for (const change of invalidChanges) {
        const data = fixture(); addHabit(data, 'checklist'); change(data);
        assert.throws(() => Model.validateData(data));
    }
    const tooMany = fixture();
    tooMany.habits = Array.from({ length: 201 }, () => Model.createHabit());
    assert.throws(() => Model.validateData(tooMany));
});

test('non-checklist habits retain checklist items for later type changes', () => {
    const data = fixture();
    const habit = addHabit(data, 'checklist');
    const originalItems = structuredClone(habit.items);
    habit.type = 'counter';
    assert.deepEqual(Model.validateData(data).habits[0].items, originalItems);
});

test('invalid progress, inherited keys, and inconsistent timer deadlines are rejected', () => {
    const mutations = [
        entry => { entry.done = 1; },
        entry => { entry.items.old = 'false'; },
        entry => { entry.items = JSON.parse('{"constructor":true}'); },
        entry => { entry.count = -1; },
        entry => { entry.count = NaN; },
        entry => { entry.timer.duration = 0; },
        entry => { entry.timer.remaining = 99999; },
        entry => { entry.timer.remaining = 0.5; },
        entry => { entry.timer.running = true; },
        entry => { entry.timer.endsAt = 1000; },
        entry => { entry.timer.running = true; entry.timer.endsAt = -1; },
        entry => { entry.timer.laps = [-1]; },
        entry => { entry.timer.laps = Array(1001).fill(0); },
        entry => { delete entry.timer; }
    ];
    for (const mutate of mutations) {
        const data = fixture(); const habit = addHabit(data, 'timer');
        mutate(Model.record(data, '2026-09-27', habit));
        assert.throws(() => Model.validateData(data));
    }
    const data = fixture();
    data.progress['2026-02-29'] = {};
    assert.throws(() => Model.validateData(data));
});

test('preferences with a custom gradient, theme and display options round-trip unchanged', () => {
    const data = fixture();
    Object.assign(data.preferences, { background: 'custom', customColors: ['#112233', '#AaBbCc', '#000000'],
        gradientAngle: 270, mode: 'dark', accent: '#CC3344', font: 'serif', compact: true,
        animations: false, celebrations: false, focus: true });
    assert.deepEqual(Model.validateData(JSON.parse(JSON.stringify(data))).preferences, data.preferences);
});
