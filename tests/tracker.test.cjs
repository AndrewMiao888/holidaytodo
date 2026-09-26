const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The challenge spans Adelaide's October daylight-saving transition.
process.env.TZ = 'Australia/Adelaide';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const appScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(script => script.includes('const TOTAL_DAYS'));
assert.ok(appScript, 'The tracker application script exists');

function makeElement() {
    const classes = new Set();
    let markup = '';
    return {
        children: [],
        hidden: false,
        checked: false,
        innerText: '',
        attrs: {},
        style: {},
        get innerHTML() { return markup; },
        set innerHTML(value) { markup = value; this.children = []; },
        classList: {
            add: value => classes.add(value),
            remove: value => classes.delete(value),
            contains: value => classes.has(value),
            toggle(value, force) {
                const enabled = force ?? !classes.has(value);
                if (enabled) classes.add(value);
                else classes.delete(value);
                return enabled;
            }
        },
        setAttribute(key, value) { this.attrs[key] = value; },
        appendChild(element) { this.children.push(element); },
        querySelectorAll() { return []; },
        scrollIntoView() { this.scrolledIntoView = true; }
    };
}

// DOM stubs exercise state and visibility behavior; they do not verify layout.
function createApp({ date = new Date(2026, 9, 4, 12), storage = new Map() } = {}) {
    let now = date.getTime();
    const elements = new Map();
    const listeners = {};
    const intervals = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const document = {
        hidden: false,
        documentElement: makeElement(),
        getElementById: element,
        createElement: makeElement,
        querySelector(selector) {
            if (selector === '#day-tabs [aria-current="date"]') {
                return element('day-tabs').children.find(tab => tab.attrs['aria-current'] === 'date') ?? null;
            }
            return null;
        },
        addEventListener: (name, callback) => { listeners[name] = callback; }
    };
    const context = vm.createContext({
        console,
        Date: TestDate,
        document,
        window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
        clearInterval() {},
        confirm: () => false
    });
    vm.runInContext(appScript, context);
    return {
        run: code => vm.runInContext(code, context),
        element,
        storage,
        listeners,
        intervals,
        setDate: value => { now = value.getTime(); },
        advance: milliseconds => { now += milliseconds; }
    };
}

function finishDay(app, day) {
    app.run(`{
        const day = trackerState[${day}];
        for (const key of ['myobrace', 'exam1', 'exam2', 'bendDown', 'jumpUp', 'run',
            'shineEyes1', 'shineEyes2', 'vitamin1', 'vitamin2', 'brushTeeth1',
            'brushTeeth2', 'probiotic1', 'probiotic2']) day[key] = true;
        day.piano.fill(true);
        day.flute.fill(true);
        day.myobraceSecondsLeft = 0;
    }`);
}

function taskCard(checkedValues, isStandaloneLabel = false) {
    const card = makeElement();
    card.labels = checkedValues.map(() => isStandaloneLabel ? card : makeElement());
    card.inputs = checkedValues.map((checked, index) => ({
        checked,
        closest: () => card.labels[index]
    }));
    card.querySelectorAll = () => card.inputs;
    return card;
}

test('Today uses local dates at both challenge boundaries and across daylight saving', () => {
    const app = createApp();
    assert.equal(new Date(2026, 9, 3, 12).getTimezoneOffset(), -570);
    assert.equal(new Date(2026, 9, 4, 12).getTimezoneOffset(), -630);
    for (let day = 1; day <= 16; day++) {
        for (const [hour, minute] of [[0, 0], [23, 59]]) {
            const localDate = new Date(2026, 8, 27 + day - 1, hour, minute);
            assert.equal(app.run(`getTodayDay(new Date(${localDate.getTime()}))`), day);
        }
    }
    assert.equal(app.run('getTodayDay(new Date(2026, 8, 26, 23, 59))'), null);
    assert.equal(app.run('getTodayDay(new Date(2026, 9, 13, 0, 0))'), null);
});

test('initial day and Today shortcut handle dates inside and outside the challenge', () => {
    const scenarios = [
        { date: new Date(2026, 8, 26, 23, 59), day: 1, disabled: true, text: /starts/ },
        { date: new Date(2026, 8, 27), day: 1, disabled: false, text: /Day 1/ },
        { date: new Date(2026, 9, 4, 12), day: 8, disabled: false, text: /Day 8/ },
        { date: new Date(2026, 9, 12, 23, 59), day: 16, disabled: false, text: /Day 16/ },
        { date: new Date(2026, 9, 13), day: 16, disabled: true, text: /ended/ }
    ];
    for (const { date, day, disabled, text } of scenarios) {
        const app = createApp({ date });
        app.run('window.onload()');
        assert.equal(app.run('activeDay'), day);
        assert.equal(app.element('today-button').disabled, disabled);
        assert.match(app.element('today-context').innerText, text);
        app.run('selectDay(3); goToToday()');
        assert.equal(app.run('activeDay'), disabled ? 3 : day);
    }
});

test('summary counts each task, excludes weekend exams, and breaks incomplete streaks', () => {
    const app = createApp();
    assert.equal(app.run('getDayCompletion(1).total'), 21);
    assert.equal(app.run('getDayCompletion(2).total'), 23);
    app.run('trackerState[1].exam1 = true; trackerState[1].exam2 = true');
    assert.equal(app.run('getDayCompletion(1).completed'), 0);
    for (const day of [1, 2, 4, 5, 6]) finishDay(app, day);
    app.run('activeDay = 7; updateOverallStats()');
    assert.equal(app.element('tasks-completed').innerText, 113);
    assert.equal(app.element('best-streak').innerText, '3 days');
    assert.equal(app.element('days-completed').innerText, '5/16');
    assert.equal(app.element('tasks-remaining').innerText, 21);
    app.run('trackerState[5].flute[0] = false; updateOverallStats()');
    assert.equal(app.element('tasks-completed').innerText, 112);
    assert.equal(app.element('best-streak').innerText, '2 days');
    assert.equal(app.element('days-completed').innerText, '4/16');
    app.run('selectDay(5)');
    assert.equal(app.element('tasks-remaining').innerText, 1);
    assert.equal(app.element('remaining-label').innerText, 'Left on Day 5');
});

test('focus view hides completed individual tasks and finished groups, then restores them', () => {
    const app = createApp();
    const mixedFlute = taskCard([true, false, true, false, false]);
    const finishedPiano = taskCard([true, true, true, true]);
    const incompleteTask = taskCard([false], true);
    const completeTask = taskCard([true], true);
    const weekendMessage = taskCard([]);
    const runningTimer = taskCard([false]);
    const cards = [mixedFlute, finishedPiano, incompleteTask, completeTask, weekendMessage, runningTimer];
    app.element('task-grid').children = cards;
    app.run('setFocusView(true)');
    assert.equal(mixedFlute.hidden, false);
    assert.deepEqual(mixedFlute.labels.map(label => label.hidden), [true, false, true, false, false]);
    assert.equal(finishedPiano.hidden, true);
    assert.equal(incompleteTask.hidden, false);
    assert.equal(completeTask.hidden, true);
    assert.equal(weekendMessage.hidden, true);
    assert.equal(runningTimer.hidden, false);
    assert.equal(app.element('focus-empty').hidden, true);
    app.run('setFocusView(false)');
    assert.ok(cards.every(card => !card.hidden));
    assert.ok(mixedFlute.labels.every(label => !label.hidden));
});

test('focus preference persists across reloads and all-complete days have an escape button', () => {
    const app = createApp();
    app.run('setFocusView(true)');
    assert.equal(app.storage.get('holiday_habit_tracker_focus'), 'true');
    const reloaded = createApp({ storage: app.storage });
    assert.equal(reloaded.run('focusOnly'), true);
    finishDay(reloaded, 1);
    reloaded.run('renderDayContent()');
    assert.equal(reloaded.element('focus-empty').hidden, false);
    assert.match(reloaded.element('day-content-card').innerHTML, /Show completed tasks/);
    assert.match(reloaded.element('focus-description').innerText, /^0 tasks left/);
    reloaded.run('setFocusView(false)');
    assert.equal(reloaded.element('focus-empty').hidden, true);
    assert.equal(reloaded.element('focus-toggle').checked, false);
    assert.equal(createApp({ storage: app.storage }).run('focusOnly'), false);
});

test('changing days and focus view preserve a background timer through completion and reload', () => {
    const app = createApp();
    app.run('activeDay = 8; startMyobraceTimer()');
    const deadline = app.run('trackerState[8].myobraceEndsAt');
    app.run('selectDay(9); setFocusView(true)');
    assert.equal(app.run('trackerState[8].myobraceRunning'), true);
    assert.equal(app.run('trackerState[8].myobraceEndsAt'), deadline);
    app.advance(60_000);
    app.run('syncMyobraceTimers()');
    assert.equal(app.run('trackerState[8].myobraceSecondsLeft'), 7140);
    assert.equal(app.run('activeDay'), 9);
    assert.equal(app.element('tasks-remaining').innerText, 23);

    const reloaded = createApp({
        date: new Date(deadline + 1000),
        storage: app.storage
    });
    reloaded.run('activeDay = 9; syncMyobraceTimers()');
    assert.equal(reloaded.run('trackerState[8].myobrace'), true);
    assert.equal(reloaded.run('trackerState[8].myobraceRunning'), false);
    assert.equal(reloaded.run('trackerState[8].myobraceSecondsLeft'), 0);
    assert.equal(reloaded.run('trackerState[8].myobraceEndsAt'), null);
    assert.equal(reloaded.run('activeDay'), 9);
    assert.equal(reloaded.element('tasks-remaining').innerText, 23);
    assert.equal(reloaded.element('tasks-completed').innerText, 1);
    assert.equal(JSON.parse(reloaded.storage.get('holiday_habit_tracker_v4'))[8].myobrace, true);
    reloaded.run('goToToday()');
    assert.equal(reloaded.run('activeDay'), 8);
    assert.equal(reloaded.element('tasks-remaining').innerText, 20);
    reloaded.run('selectDay(0); selectDay(17); selectDay(2.5)');
    assert.equal(reloaded.run('activeDay'), 8);
});
