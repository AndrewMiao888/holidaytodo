const assert = require('node:assert/strict');
const test = require('node:test');
let Model, Backup;

test.before(async () => {
    Model = (await import('../shared/tracker-model.mjs')).default;
    Backup = await import('../shared/tracker-backup.mjs');
});

const NOW = Date.UTC(2026, 8, 27, 12);

function fixture() {
    const data = Model.createDefaultData(new Date(2026, 8, 27, 12));
    data.challenge = { name: 'My custom music routine', startDate: '2027-01-01', days: 90 };
    data.preferences = { background: 'custom', customColors: ['#123456', '#aBcDeF', '#101010'],
        gradientAngle: 215, mode: 'dark', accent: '#FFA500', font: 'serif', compact: true,
        animations: false, celebrations: false, focus: true };
    const habit = Object.assign(Model.createHabit('checklist'), {
        id: 'custom_music', name: 'Music & expression', category: 'Creative time', icon: '🎵',
        description: 'Play slowly, then repeat.', color: '#a855f7',
        messages: ['{habit}: {item} complete!', 'Your {target} {unit} goal is complete.'],
        items: [{ id: 'first', label: 'A chosen scale' }, { id: 'second', label: 'A new piece' }],
        weekdays: [1, 3, 5], target: 1, unit: ''
    });
    data.habits.push(habit);
    const progress = Model.record(data, '2026-09-27', habit);
    progress.items.first = true;
    progress.items.retired_item = true;
    return data;
}

function oldDay() {
    return {
        myobrace: false, myobraceSecondsLeft: 7200, myobraceRunning: false, myobraceEndsAt: null, myobraceLaps: [],
        exam1: false, exam2: true, bendDown: true, jumpUp: false, run: true,
        flute: [true, false, true, false, true], piano: [false, true, false, true],
        shineEyes1: true, shineEyes2: false, vitamin1: false, vitamin2: true,
        brushTeeth1: true, brushTeeth2: false, probiotic1: false, probiotic2: true
    };
}

function legacy() {
    return Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 1, oldDay()]));
}

function legacyBackup() {
    return { format: 'holiday-habit-tracker', version: 1, exportedAt: new Date(NOW).toISOString(), days: legacy(), background: 'peach-sky' };
}

function addTimer(data, key = '2026-09-27') {
    const habit = Object.assign(Model.createHabit('timer'), { id: 'custom_timer', target: 120 });
    data.habits.push(habit);
    const entry = Model.record(data, key, habit);
    entry.timer.running = true;
    entry.timer.endsAt = NOW + 120_000;
    entry.timer.laps = [20, 40];
    return { habit, entry };
}

test('version2 backups include the complete custom schema, preferences and historical progress', () => {
    const data = fixture();
    const backup = Backup.createBackup(data, NOW);
    assert.equal(backup.format, 'holiday-habit-tracker');
    assert.equal(backup.version, 2);
    assert.equal(backup.exportedAt, new Date(NOW).toISOString());
    assert.deepEqual(backup.data, data);
    const restored = Backup.parseBackup(JSON.parse(JSON.stringify(backup)), NOW);
    assert.deepEqual(restored, data);
    assert.equal(restored.progress['2026-09-27'].custom_music.items.retired_item, true);
    assert.equal(restored.challenge.days, 90);
    assert.equal(restored.preferences.gradientAngle, 215);
    assert.equal(restored.habits[0].messages[0], '{habit}: {item} complete!');
});

test('export validation and timer synchronization use a clone and never change the live data', () => {
    const data = fixture();
    const { entry } = addTimer(data);
    const before = JSON.stringify(data);
    const backup = Backup.createBackup(data, NOW + 180_000);
    assert.equal(JSON.stringify(data), before);
    assert.equal(entry.timer.running, true);
    assert.equal(entry.done, false);
    const saved = backup.data.progress['2026-09-27'].custom_timer;
    assert.equal(saved.timer.running, false);
    assert.equal(saved.timer.endsAt, null);
    assert.equal(saved.timer.remaining, 0);
    assert.equal(saved.done, true);
    backup.data.habits[0].items[0].label = 'Changed';
    assert.equal(data.habits[0].items[0].label, 'A chosen scale');
});

test('import synchronizes running timers after time away without restarting their deadlines', () => {
    const data = fixture();
    addTimer(data);
    const backup = Backup.createBackup(data, NOW);
    const before = JSON.stringify(backup);
    const restored = Backup.parseBackup(backup, NOW + 50_001);
    const timer = restored.progress['2026-09-27'].custom_timer.timer;
    assert.equal(timer.remaining, 70);
    assert.equal(timer.endsAt, NOW + 120_000);
    assert.equal(timer.running, true);
    assert.deepEqual(timer.laps, [20, 40]);
    assert.equal(JSON.stringify(backup), before);
    const expired = Backup.parseBackup(backup, NOW + 300_000);
    assert.equal(expired.progress['2026-09-27'].custom_timer.done, true);
});

test('export and import include archived running timers on dates outside the configured challenge', () => {
    const data = fixture();
    const { habit } = addTimer(data, '2024-01-01');
    habit.archived = true;
    habit.weekdays = [];
    const backup = Backup.createBackup(data, NOW + 10_000);
    assert.equal(backup.data.habits[1].archived, true);
    assert.equal(backup.data.progress['2024-01-01'].custom_timer.timer.remaining, 110);
    const restored = Backup.parseBackup(backup, NOW + 500_000);
    assert.equal(restored.progress['2024-01-01'].custom_timer.done, true);
    assert.equal(restored.habits[1].archived, true);
});

test('normalization strips unknown fields but preserves user text as data', () => {
    const data = fixture();
    data.habits[0].name = '<img src=x onerror=alert(1)>';
    data.extra = 'not in the format';
    data.preferences.onclick = 'bad()';
    const backup = Backup.createBackup(data, NOW);
    assert.equal(backup.data.extra, undefined);
    assert.equal(backup.data.preferences.onclick, undefined);
    backup.data.habits[0].onclick = 'bad()';
    backup.unknownMetadata = true;
    const restored = Backup.parseBackup(backup, NOW);
    assert.equal(restored.habits[0].onclick, undefined);
    assert.equal(restored.unknownMetadata, undefined);
    assert.equal(restored.habits[0].name, '<img src=x onerror=alert(1)>');
});

test('version1 imports preserve every old task, background, original calendar and paired routines', () => {
    const payload = legacyBackup();
    const before = JSON.stringify(payload);
    const restored = Backup.parseBackup(payload, NOW);
    assert.equal(restored.version, 5);
    assert.deepEqual(restored.challenge, { name: '16-Day Holiday Habit Tracker', startDate: '2026-09-27', days: 16 });
    assert.equal(restored.preferences.background, 'peach-sky');
    assert.equal(Object.keys(restored.progress).length, 16);
    const day = restored.progress['2026-09-27'];
    assert.equal(day.bendDown.count, 20);
    assert.equal(day.bendDown.done, true);
    assert.equal(restored.habits.find(habit => habit.id === 'bendDown').type, 'check');
    assert.equal(day.run.count, 1);
    assert.deepEqual(Object.values(day.flute.items), payload.days[1].flute);
    assert.deepEqual(Object.values(day.piano.items), payload.days[1].piano);
    assert.deepEqual(day.exam.items, { session1: false, session2: true });
    assert.deepEqual(day.brushTeeth.items, { morning: true, evening: false });
    assert.equal(Model.getDayStats(restored, '2026-09-27').total, 21);
    assert.equal(Model.getDayStats(restored, '2026-09-28').total, 23);
    assert.equal(JSON.stringify(payload), before);
});

test('legacy timers with no deadline account for all elapsed time since the export timestamp', () => {
    const payload = legacyBackup();
    payload.days[1].myobraceRunning = true;
    payload.days[1].myobraceSecondsLeft = 600;
    payload.days[1].myobraceLaps = [60, 180];
    delete payload.days[1].myobraceEndsAt;
    const restored = Backup.parseBackup(payload, NOW + 240_000);
    const timer = restored.progress['2026-09-27'].myobrace.timer;
    assert.equal(timer.endsAt, NOW + 600_000);
    assert.equal(timer.remaining, 360);
    assert.deepEqual(timer.laps, [60, 180]);
    assert.equal(timer.running, true);
    const expired = Backup.parseBackup(payload, NOW + 900_000);
    assert.equal(expired.progress['2026-09-27'].myobrace.done, true);
    assert.equal(expired.progress['2026-09-27'].myobrace.timer.endsAt, null);
});

test('legacy explicit deadlines are preserved even if stored remaining seconds are stale', () => {
    const payload = legacyBackup();
    payload.days[1].myobraceRunning = true;
    payload.days[1].myobraceSecondsLeft = 7000;
    payload.days[1].myobraceEndsAt = NOW + 300_000;
    const restored = Backup.parseBackup(payload, NOW + 120_000);
    assert.equal(restored.progress['2026-09-27'].myobrace.timer.remaining, 180);
    assert.equal(restored.progress['2026-09-27'].myobrace.timer.endsAt, NOW + 300_000);
});

test('raw legacy progress uses the supplied background and a current deadline reference', () => {
    const payload = legacy();
    payload[1].myobraceRunning = true;
    payload[1].myobraceSecondsLeft = 100;
    payload[1].myobraceEndsAt = null;
    payload[2].flute = true;
    const restored = Backup.parseBackup(payload, NOW, 'rosewater');
    assert.equal(restored.preferences.background, 'rosewater');
    assert.equal(restored.progress['2026-09-27'].myobrace.timer.endsAt, NOW + 100_000);
    assert.deepEqual(Object.values(restored.progress['2026-09-28'].flute.items), Array(5).fill(true));
    assert.equal(Backup.parseBackup(legacy(), NOW).preferences.background, 'auto');
});

test('partial legacy backup days and day arrays are rejected', () => {
    for (const enveloped of [false, true]) {
        for (const mutate of [
            days => { delete days[16]; },
            days => { days[17] = oldDay(); },
            days => { days[1] = []; },
            days => { days[1] = null; },
            days => { days.extra = oldDay(); }
        ]) {
            const days = legacy();
            mutate(days);
            const payload = enveloped ? { ...legacyBackup(), days } : days;
            assert.throws(() => Backup.parseBackup(payload, NOW));
        }
    }
    assert.throws(() => Backup.parseBackup(Object.values(legacy()), NOW));
    assert.throws(() => Backup.parseBackup({ ...legacyBackup(), days: Object.values(legacy()) }, NOW));
    assert.throws(() => Backup.parseBackup({}, NOW));
});

test('legacy malformed task values, background fields and conflicting timers are rejected', () => {
    for (const mutate of [
        payload => { payload.days[1].exam1 = 'true'; },
        payload => { payload.days[1].flute = [true]; },
        payload => { payload.days[1].piano[0] = 1; },
        payload => { payload.days[1].myobraceSecondsLeft = -1; },
        payload => { payload.days[1].myobrace = true; },
        payload => { payload.days[1].myobraceLaps = [8000]; },
        payload => { payload.days[1].myobraceEndsAt = NOW; },
        payload => { delete payload.background; },
        payload => { payload.background = 1; },
        payload => { payload.background = 'url(javascript:bad)'; }
    ]) {
        const payload = legacyBackup();
        mutate(payload);
        assert.throws(() => Backup.parseBackup(payload, NOW));
    }
});

test('unsupported formats, versions and malformed top-level values are rejected', () => {
    for (const payload of [null, [], 'json text', 5, true,
        { format: 'another-app', version: 2 }, { format: 'holiday-habit-tracker', version: 3 },
        { format: 'holiday-habit-tracker', version: '2' }, { format: 'holiday-habit-tracker' },
        { format: undefined, ...legacy() }, Object.create({ format: 'holiday-habit-tracker' })]) {
        assert.throws(() => Backup.parseBackup(payload, NOW));
    }
    assert.throws(() => Backup.parseBackup(fixture(), NOW), 'raw v5 data is not an exported backup envelope');
});

test('both backup versions require a sane export timestamp and reject impossible dates', () => {
    const invalidDates = [undefined, null, NOW, '', 'yesterday', '2026-09-27',
        '2026-02-30T12:00:00.000Z', '2026-09-27T24:00:00.000Z',
        '2026-09-27T12:60:00Z', '1969-12-31T23:59:59.999Z',
        new Date(NOW + 60001).toISOString()];
    for (const source of [legacyBackup(), Backup.createBackup(fixture(), NOW)]) {
        for (const exportedAt of invalidDates) assert.throws(() => Backup.parseBackup({ ...source, exportedAt }, NOW));
        assert.equal(Backup.parseBackup({ ...source, exportedAt: new Date(NOW + 60000).toISOString() }, NOW).version, 5);
        assert.equal(Backup.parseBackup({ ...source, exportedAt: '2026-09-27T12:00:00Z' }, NOW).version, 5);
        assert.equal(Backup.parseBackup({ ...source, exportedAt: '2026-09-27T13:00:00+01:00' }, NOW).version, 5);
    }
});

test('v2 imports and exports enforce the current schema rather than trusting backup metadata', () => {
    for (const mutate of [
        data => { data.version = 4; },
        data => { data.challenge.days = 0; },
        data => { data.habits[0].id = '__proto__'; },
        data => { data.habits[0].items[0].label = 'x'.repeat(101); },
        data => { data.preferences.accent = 'url(bad)'; },
        data => { data.progress['2026-09-27'].custom_music.items.first = 'true'; },
        data => { data.progress['2026-09-27'].custom_music.timer.running = true; }
    ]) {
        const data = fixture(); mutate(data);
        assert.throws(() => Backup.createBackup(data, NOW));
        assert.throws(() => Backup.parseBackup({ format: Backup.BACKUP_FORMAT, version: 2, exportedAt: new Date(NOW).toISOString(), data }, NOW));
    }
    assert.throws(() => Backup.parseBackup({ format: Backup.BACKUP_FORMAT, version: 2, exportedAt: new Date(NOW).toISOString() }, NOW));
});

test('backup helpers reject invalid clocks and have no browser globals or storage side effects', () => {
    for (const now of [NaN, Infinity, -1, 'today', NOW + 0.5, Number.MAX_SAFE_INTEGER]) {
        assert.throws(() => Backup.createBackup(fixture(), now));
        assert.throws(() => Backup.parseBackup(legacyBackup(), now));
    }
    assert.equal(Backup.default.createBackup, Backup.createBackup);
    assert.equal(Backup.default.parseBackup, Backup.parseBackup);
    assert.equal(globalThis.TrackerBackup, undefined);
    assert.equal(globalThis.TrackerModel, undefined);
});
