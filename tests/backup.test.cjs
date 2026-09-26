const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Select the app script explicitly: the first inline script configures Tailwind.
const mainScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => /\bconst TOTAL_DAYS\b/.test(source));
assert.ok(mainScript, 'The tracker application script must be present.');
const backupScript = fs.readFileSync(path.join(root, 'tracker-backup.js'), 'utf8');
const STATE_KEY = 'holiday_habit_tracker_v4';
const BACKGROUND_KEY = 'holiday_habit_tracker_background';
const FOCUS_KEY = 'holiday_habit_tracker_focus';

function createApp() {
    const clock = { now: Date.parse('2026-09-27T00:00:00Z') };
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    const status = { textContent: '', dataset: {} };
    const storage = new Map([[BACKGROUND_KEY, 'auto'], [FOCUS_KEY, 'true']]);
    const calls = { confirmations: 0, renders: 0, downloads: 0, revoked: 0 };
    const context = {
        Date: TestDate,
        Blob,
        setTimeout: callback => callback(),
        confirm: () => { calls.confirmations++; return true; },
        document: {
            addEventListener() {},
            getElementById: () => status,
            body: { appendChild() {} },
            createElement: () => ({ click: () => calls.downloads++, remove() {} })
        },
        window: { addEventListener() {} },
        URL: {
            createObjectURL: blob => { calls.downloadedBlob = blob; return 'blob:test'; },
            revokeObjectURL: () => calls.revoked++
        },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        }
    };
    vm.createContext(context);
    vm.runInContext(mainScript, context, { filename: 'index.html' });
    vm.runInContext(backupScript, context, { filename: 'tracker-backup.js' });

    // Exercise real tracker data/loading/saving; rendering is covered separately.
    for (const name of ['applyTimeTheme', 'renderBackgroundOptions', 'renderTabs', 'renderDayContent', 'updateOverallStats']) {
        context[name] = () => calls.renders++;
    }
    context.saveState();
    calls.renders = 0;
    const read = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
    const payload = () => ({
        format: 'holiday-habit-tracker',
        version: 1,
        exportedAt: new Date(clock.now).toISOString(),
        days: read('trackerState'),
        background: read('backgroundGradients[0].id')
    });
    return { context, clock, status, storage, calls, read, payload };
}

function fileInput(payload) {
    const contents = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
        value: 'selected-backup.json',
        files: [{ size: Buffer.byteLength(contents), text: async () => contents }]
    };
}

test('the integrated app exports only challenge data and can restore that download', async () => {
    const app = createApp();
    vm.runInContext('trackerState[2].flute[4] = true; trackerState[3].piano[1] = true;', app.context);
    app.context.downloadBackup();
    const exported = JSON.parse(await app.calls.downloadedBlob.text());
    assert.equal(app.calls.downloads, 1);
    assert.equal(app.calls.revoked, 1);
    assert.equal(Object.keys(exported.days).length, 16);
    assert.deepEqual(Object.keys(exported).sort(), ['background', 'days', 'exportedAt', 'format', 'version']);
    assert.equal(exported.days[2].flute[4], true);

    vm.runInContext('trackerState[2].flute[4] = false; trackerState[3].piano[1] = false;', app.context);
    const input = fileInput(exported);
    await app.context.restoreBackup(input);
    assert.equal(app.read('trackerState[2].flute[4]'), true);
    assert.equal(app.read('trackerState[3].piano[1]'), true);
    assert.deepEqual(JSON.parse(app.storage.get(STATE_KEY)), exported.days);
    assert.equal(app.calls.confirmations, 1);
    assert.equal(app.calls.renders, 5);
    assert.equal(input.value, '');
    assert.equal(app.storage.get(FOCUS_KEY), 'true');
    assert.equal(app.read('focusOnly'), true);
    assert.match(app.status.textContent, /Backup restored/);
});

test('restore persists and applies the selected background', async () => {
    const app = createApp();
    const backup = app.payload();
    await app.context.restoreBackup(fileInput(backup));
    assert.equal(app.read('selectedBackground'), backup.background);
    assert.equal(app.storage.get(BACKGROUND_KEY), backup.background);
});

test('malformed backup fields are rejected before confirmation without replacing progress', async t => {
    const invalid = [
        ['missing day', data => delete data.days[16]],
        ['extra day', data => { data.days[17] = {}; }],
        ['nonboolean task', data => { data.days[1].run = 'true'; }],
        ['wrong flute count', data => { data.days[1].flute = [true]; }],
        ['nonboolean piano entry', data => { data.days[1].piano[1] = 1; }],
        ['negative timer', data => { data.days[1].myobraceSecondsLeft = -1; }],
        ['timer over two hours', data => { data.days[1].myobraceSecondsLeft = 7201; }],
        ['fractional timer', data => { data.days[1].myobraceSecondsLeft = 1.5; }],
        ['negative lap', data => { data.days[1].myobraceLaps = [-1]; }],
        ['oversized lap', data => { data.days[1].myobraceLaps = [7201]; }],
        ['nonboolean running flag', data => { data.days[1].myobraceRunning = 1; }],
        ['deadline on stopped timer', data => { data.days[1].myobraceEndsAt = Date.parse(data.exportedAt); }],
        ['nonnumeric deadline', data => { data.days[1].myobraceRunning = true; data.days[1].myobraceEndsAt = 'tomorrow'; }],
        ['deadline too far ahead', data => { data.days[1].myobraceRunning = true; data.days[1].myobraceEndsAt = Date.parse(data.exportedAt) + 86400000; }],
        ['completed timer with time remaining', data => { data.days[1].myobrace = true; }],
        ['unknown gradient', data => { data.background = 'unknown'; }],
        ['unsupported version', data => { data.version = 2; }],
        ['invalid export date', data => { data.exportedAt = 'invalid'; }],
        ['future export date', data => { data.exportedAt = '2026-09-28T00:00:00Z'; }]
    ];
    for (const [name, change] of invalid) {
        await t.test(name, async () => {
            const app = createApp();
            const backup = app.payload();
            const before = app.read('trackerState');
            const saved = app.storage.get(STATE_KEY);
            change(backup);
            await app.context.restoreBackup(fileInput(backup));
            assert.equal(app.calls.confirmations, 0);
            assert.deepEqual(app.read('trackerState'), before);
            assert.equal(app.storage.get(STATE_KEY), saved);
            assert.equal(app.status.dataset.error, 'true');
        });
    }
});

test('invalid JSON and unrelated JSON do not replace progress', async t => {
    for (const contents of ['{', 'null', '[]', '{}']) {
        await t.test(contents, async () => {
            const app = createApp();
            await app.context.restoreBackup(fileInput(contents));
            assert.equal(app.calls.confirmations, 0);
            assert.equal(app.calls.renders, 0);
            assert.equal(app.status.dataset.error, 'true');
        });
    }
});

test('oversized files are rejected without reading their contents', async () => {
    const app = createApp();
    let read = false;
    await app.context.restoreBackup({
        value: 'oversized.json',
        files: [{ size: 1048577, text: async () => { read = true; return '{}'; } }]
    });
    assert.equal(read, false);
    assert.equal(app.calls.confirmations, 0);
    assert.equal(app.status.dataset.error, 'true');
});

test('cancelling a valid restore leaves stored progress and preferences unchanged', async () => {
    const app = createApp();
    app.context.confirm = () => { app.calls.confirmations++; return false; };
    const before = [...app.storage];
    await app.context.restoreBackup(fileInput(app.payload()));
    assert.equal(app.calls.confirmations, 1);
    assert.deepEqual([...app.storage], before);
    assert.equal(app.calls.renders, 0);
    assert.match(app.status.textContent, /cancelled/);
});

test('legacy flute and running timers migrate using the backup date', async () => {
    const app = createApp();
    const backup = app.payload();
    backup.days[1].flute = true;
    backup.days[1].myobraceRunning = true;
    backup.days[1].myobraceSecondsLeft = 600;
    delete backup.days[1].myobraceEndsAt;
    app.clock.now += 30000;
    await app.context.restoreBackup(fileInput(backup));
    assert.deepEqual(app.read('trackerState[1].flute'), [true, true, true, true, true]);
    assert.equal(app.read('trackerState[1].myobraceEndsAt'), Date.parse(backup.exportedAt) + 600000);
    assert.equal(app.read('trackerState[1].myobraceSecondsLeft'), 570);
});

test('legacy raw progress preserves the current background and resumes a timer', async () => {
    const app = createApp();
    const days = app.payload().days;
    days[1].myobraceRunning = true;
    days[1].myobraceSecondsLeft = 600;
    delete days[1].myobraceEndsAt;
    await app.context.restoreBackup(fileInput(days));
    assert.equal(app.read('selectedBackground'), 'auto');
    assert.equal(app.read('trackerState[1].myobraceRunning'), true);
    assert.equal(app.read('trackerState[1].myobraceEndsAt'), app.clock.now + 600000);
});

test('running deadlines survive restore and time spent in the confirmation dialog', async () => {
    const app = createApp();
    const backup = app.payload();
    backup.days[1].myobraceRunning = true;
    backup.days[1].myobraceEndsAt = app.clock.now + 300000;
    app.context.confirm = () => { app.clock.now += 10000; return true; };
    await app.context.restoreBackup(fileInput(backup));
    assert.equal(app.read('trackerState[1].myobraceEndsAt'), backup.days[1].myobraceEndsAt);
    assert.equal(app.read('trackerState[1].myobraceSecondsLeft'), 290);
});

test('expired timers restore as completed', async () => {
    const app = createApp();
    const backup = app.payload();
    backup.days[1].myobraceRunning = true;
    backup.days[1].myobraceEndsAt = app.clock.now - 10000;
    await app.context.restoreBackup(fileInput(backup));
    const day = app.read('trackerState[1]');
    assert.equal(day.myobrace, true);
    assert.equal(day.myobraceSecondsLeft, 0);
    assert.equal(day.myobraceRunning, false);
    assert.equal(day.myobraceEndsAt, null);
});

test('failed storage writes leave the app unchanged and roll back prior writes', async t => {
    for (const failedKey of [STATE_KEY, BACKGROUND_KEY]) {
        await t.test(failedKey, async () => {
            const app = createApp();
            const before = app.read('trackerState');
            const saved = [...app.storage];
            const setItem = app.context.localStorage.setItem;
            let failed = false;
            app.context.localStorage.setItem = (key, value) => {
                if (key === failedKey && !failed) { failed = true; throw new Error('Storage quota exceeded'); }
                setItem(key, value);
            };
            const backup = app.payload();
            backup.days[1].run = true;
            await app.context.restoreBackup(fileInput(backup));
            assert.deepEqual(app.read('trackerState'), before);
            assert.deepEqual([...app.storage], saved);
            assert.equal(app.calls.renders, 0);
            assert.equal(app.status.dataset.error, 'true');
        });
    }
});

test('extra data is excluded from restored task records', async () => {
    const app = createApp();
    const backup = app.payload();
    backup.days[1].unexpected = '<script>untrusted()</script>';
    backup.extra = 'unrelated data';
    await app.context.restoreBackup(fileInput(backup));
    assert.equal(Object.hasOwn(app.read('trackerState[1]'), 'unexpected'), false);
    assert.equal(app.storage.size, 3);
});
