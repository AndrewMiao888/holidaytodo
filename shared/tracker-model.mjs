const STORAGE_KEY = 'holiday_habit_tracker_v5';
const TYPES = ['check', 'checklist', 'counter', 'timer'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MAX_TIMER_SECONDS = 604800;
const LIMITS = Object.freeze({ habits: 200, items: 100, messages: 20, name: 100,
    icon: 24, category: 60, description: 500, unit: 40, message: 500,
    counter: 1000000000, timer: MAX_TIMER_SECONDS, dates: 5000, laps: 1000 });
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);
let idSequence = 0;

function fail(path, explanation) { throw new Error(`${path}: ${explanation}`); }
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, 'must be a plain object');
    return value;
}
function string(value, path, maximum, empty = false) {
    if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
        fail(path, `must be ${empty ? 'text' : 'non-empty text'} of at most ${maximum} characters`);
    }
    return value;
}
function number(value, path, minimum, maximum, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) {
        fail(path, `must be ${integer ? 'an integer' : 'a number'} from ${minimum} to ${maximum}`);
    }
    return value;
}
function boolean(value, path) {
    if (typeof value !== 'boolean') fail(path, 'must be true or false');
    return value;
}
function id(value, path) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || RESERVED_IDS.has(value)) fail(path, 'has an invalid identifier');
    return value;
}
function color(value, path) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(path, 'must be a six-digit hex colour');
    return value;
}
function array(value, path, maximum, minimum = 0) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(path, `must contain ${minimum} to ${maximum} entries`);
    for (let i = 0; i < value.length; i++) if (!own(value, i)) fail(path, 'cannot contain empty entries');
    return value;
}
function choice(value, path, values) {
    if (!values.includes(value)) fail(path, 'has an unsupported value');
    return value;
}

function dateKey(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) fail('Date', 'is invalid');
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Noon and calendar arithmetic avoid UTC conversions and DST date drift.
function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Date', 'must use YYYY-MM-DD');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(2000, 0, 1, 12, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) fail('Date', 'is not a real calendar date');
    return date;
}

function uid() {
    idSequence += 1;
    const crypto = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') return `h_${crypto.randomUUID()}`;
    return `h_${Date.now().toString(36)}_${idSequence.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

function createHabit(type = 'check') {
    choice(type, 'Habit type', TYPES);
    return {
        id: uid(), name: 'New habit', icon: '✨', category: 'My habits', description: '', type,
        target: type === 'timer' ? 1500 : 1, unit: type === 'counter' ? 'times' : '',
        items: type === 'checklist' ? [{ id: uid(), label: 'First step' }] : [],
        weekdays: ALL_DAYS.slice(), color: '#7c3aed', messages: [], archived: false
    };
}

function createDefaultData(now = new Date()) {
    const current = now instanceof Date ? now : new Date(now);
    return {
        version: 5,
        challenge: { name: 'My Habit Tracker', startDate: dateKey(current), days: 14 },
        habits: [], progress: {},
        preferences: {
            background: 'auto', customColors: ['#ffedd5', '#ddd6fe', '#bae6fd'], gradientAngle: 135,
            mode: 'auto', accent: '#7c3aed', font: 'inter', compact: false,
            animations: true, celebrations: true, focus: false
        }
    };
}

function validateHabit(source, path) {
    object(source, path);
    const type = choice(source.type, `${path}.type`, TYPES);
    const itemIds = new Set();
    const items = array(source.items, `${path}.items`, LIMITS.items, type === 'checklist' ? 1 : 0).map((item, index) => {
        const location = `${path}.items[${index}]`;
        object(item, location);
        const itemId = id(item.id, `${location}.id`);
        if (itemIds.has(itemId)) fail(location, 'duplicate item identifier');
        itemIds.add(itemId);
        return { id: itemId, label: string(item.label, `${location}.label`, LIMITS.name) };
    });
    const weekdays = array(source.weekdays, `${path}.weekdays`, 7).map((day, index) => number(day, `${path}.weekdays[${index}]`, 0, 6, true));
    if (new Set(weekdays).size !== weekdays.length) fail(`${path}.weekdays`, 'has duplicate days');
    return {
        id: id(source.id, `${path}.id`), name: string(source.name, `${path}.name`, LIMITS.name),
        icon: string(source.icon, `${path}.icon`, LIMITS.icon, true), category: string(source.category, `${path}.category`, LIMITS.category, true),
        description: string(source.description, `${path}.description`, LIMITS.description, true), type,
        target: number(source.target, `${path}.target`, type === 'timer' ? 1 : Number.MIN_VALUE, type === 'timer' ? LIMITS.timer : LIMITS.counter, type === 'timer'),
        unit: string(source.unit, `${path}.unit`, LIMITS.unit, true), items, weekdays,
        color: color(source.color, `${path}.color`),
        messages: array(source.messages, `${path}.messages`, LIMITS.messages).map((message, index) => string(message, `${path}.messages[${index}]`, LIMITS.message)),
        archived: boolean(source.archived, `${path}.archived`)
    };
}

function validateTimer(source, path) {
    object(source, path);
    const duration = number(source.duration, `${path}.duration`, 1, MAX_TIMER_SECONDS, true);
    const remaining = number(source.remaining, `${path}.remaining`, 0, duration, true);
    const running = boolean(source.running, `${path}.running`);
    const endsAt = source.endsAt === null ? null : number(source.endsAt, `${path}.endsAt`, 1, 8640000000000000, true);
    if (running !== (endsAt !== null)) fail(path, 'running timers require a deadline; paused timers cannot have one');
    return { duration, remaining, endsAt, running,
        laps: array(source.laps, `${path}.laps`, LIMITS.laps).map((lap, index) => number(lap, `${path}.laps[${index}]`, 0, duration, true)) };
}

function validateRecord(source, path) {
    object(source, path);
    object(source.items, `${path}.items`);
    if (Object.keys(source.items).length > 1000) fail(`${path}.items`, 'has too many historical items');
    const items = {};
    for (const [key, value] of Object.entries(source.items)) items[id(key, `${path}.items`)] = boolean(value, `${path}.items.${key}`);
    return { done: boolean(source.done, `${path}.done`), items,
        count: number(source.count, `${path}.count`, 0, LIMITS.counter), timer: validateTimer(source.timer, `${path}.timer`) };
}

function validateData(source) {
    object(source, 'Tracker');
    if (source.version !== 5) fail('Tracker version', 'is not supported');
    object(source.challenge, 'Challenge');
    const startDate = dateKey(parseDate(source.challenge.startDate));
    const days = number(source.challenge.days, 'Challenge days', 1, 366, true);
    const endDate = parseDate(startDate);
    endDate.setDate(endDate.getDate() + days - 1);
    dateKey(endDate);
    const habits = array(source.habits, 'Habits', LIMITS.habits).map((habit, index) => validateHabit(habit, `Habit ${index + 1}`));
    const habitIds = new Set(habits.map(habit => habit.id));
    if (habitIds.size !== habits.length) fail('Habits', 'have duplicate identifiers');
    object(source.progress, 'Progress');
    if (Object.keys(source.progress).length > LIMITS.dates) fail('Progress', 'has too many dates');
    const progress = {};
    for (const [key, value] of Object.entries(source.progress)) {
        parseDate(key);
        object(value, `Progress ${key}`);
        if (Object.keys(value).length > 1000) fail(`Progress ${key}`, 'has too many historical habits');
        const day = {};
        for (const [habitId, entry] of Object.entries(value)) day[id(habitId, `Progress ${key}`)] = validateRecord(entry, `Progress ${key}.${habitId}`);
        progress[key] = day;
    }
    const preferences = object(source.preferences, 'Preferences');
    return {
        version: 5,
        challenge: { name: string(source.challenge.name, 'Challenge name', LIMITS.name), startDate, days },
        habits, progress,
        preferences: {
            background: id(preferences.background, 'Background'),
            customColors: array(preferences.customColors, 'Gradient colours', 3, 3).map((value, index) => color(value, `Gradient colour ${index + 1}`)),
            gradientAngle: number(preferences.gradientAngle, 'Gradient angle', 0, 360),
            mode: choice(preferences.mode, 'Colour mode', ['auto', 'light', 'dark']),
            accent: color(preferences.accent, 'Accent colour'),
            font: choice(preferences.font, 'Font', ['inter', 'system', 'serif']),
            compact: boolean(preferences.compact, 'Compact layout'), animations: boolean(preferences.animations, 'Animations'),
            celebrations: boolean(preferences.celebrations, 'Celebrations'), focus: boolean(preferences.focus, 'Focus view')
        }
    };
}

function calendar(data) {
    const first = parseDate(data.challenge.startDate);
    return Array.from({ length: data.challenge.days }, (_, index) => {
        const date = new Date(first);
        date.setDate(first.getDate() + index);
        return { key: dateKey(date), date, dayNum: index + 1,
            label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) };
    });
}

function isScheduled(habit, key) {
    return !habit.archived && habit.weekdays.includes(parseDate(key).getDay());
}

function record(data, key, habit) {
    parseDate(key);
    id(habit.id, 'Habit');
    if (!own(data.progress, key)) data.progress[key] = {};
    if (!own(data.progress[key], habit.id)) {
        const duration = habit.type === 'timer' ? habit.target : 1;
        data.progress[key][habit.id] = { done: false, items: {}, count: 0,
            timer: { duration, remaining: duration, endsAt: null, running: false, laps: [] } };
    }
    return data.progress[key][habit.id];
}

function getDayStats(data, key) {
    parseDate(key);
    let completed = 0;
    let total = 0;
    for (const habit of data.habits) {
        if (!isScheduled(habit, key)) continue;
        const entry = data.progress[key] && own(data.progress[key], habit.id) ? data.progress[key][habit.id] : null;
        if (habit.type === 'checklist') {
            total += habit.items.length;
            completed += habit.items.filter(item => entry && own(entry.items, item.id) && entry.items[item.id]).length;
        } else {
            total += 1;
            if (entry && (habit.type === 'counter' ? entry.count >= habit.target : entry.done)) completed += 1;
        }
    }
    return { completed, total, percentage: total ? Math.round(completed / total * 100) : 0 };
}

function getSummary(data) {
    let completed = 0, total = 0, daysCompleted = 0, bestStreak = 0, streak = 0;
    for (const day of calendar(data)) {
        const stats = getDayStats(data, day.key);
        completed += stats.completed;
        total += stats.total;
        if (stats.total > 0 && stats.completed === stats.total) {
            daysCompleted += 1;
            streak += 1;
            bestStreak = Math.max(bestStreak, streak);
        } else streak = 0;
    }
    return { completed, total, daysCompleted, bestStreak };
}

function syncTimers(data, now = Date.now()) {
    number(now, 'Current time', 0, 8640000000000000);
    const completions = [];
    // Include dates outside the current challenge and archived habits.
    for (const [key, day] of Object.entries(data.progress)) {
        for (const [habitId, entry] of Object.entries(day)) {
            const timer = entry.timer;
            if (!timer.running) continue;
            timer.remaining = Math.min(timer.duration, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));
            if (timer.remaining === 0) {
                timer.running = false;
                timer.endsAt = null;
                entry.done = true;
                completions.push({ dateKey: key, habitId });
            }
        }
    }
    return completions;
}

function migrateLegacy(legacy, background = 'auto', focus = false, now = Date.now()) {
    object(legacy, 'Legacy progress');
    number(now, 'Migration time', 0, 8640000000000000);
    const data = createDefaultData(new Date(2026, 8, 27, 12));
    data.challenge = { name: 'Holiday Habit Tracker', startDate: '2026-09-27', days: 16 };
    data.preferences.background = id(background, 'Legacy background');
    data.preferences.focus = boolean(focus, 'Legacy focus');
    function habit(stableId, name, type, category, icon, extra = {}) {
        const value = Object.assign(createHabit(type), { id: stableId, name, type, category, icon }, extra);
        data.habits.push(value);
        return value;
    }
    function items(entries) { return entries.map(([itemId, label]) => ({ id: itemId, label })); }
    habit('myobrace', 'Myobrace', 'timer', 'Daily routine', '⏱️', { target: 7200, description: '2 hours of wear time', messages: ['{habit} goal complete! Well done for sticking with your wear-time routine.'] });
    habit('exam', 'Exam Questions', 'checklist', 'Study', '📚', { weekdays: [1, 2, 3, 4, 5], items: items([['session1', 'Session 1 · 50 questions'], ['session2', 'Session 2 · 50 questions']]), messages: ['{habit}: {item} complete! Be proud of the focus you brought to studying.'] });
    habit('bendDown', 'Bend Down', 'counter', 'Movement', '🙆', { target: 20, unit: 'repetitions', messages: ['{habit}: {target} {unit} complete! Great commitment to your exercise routine.'] });
    habit('jumpUp', 'Jump Up', 'counter', 'Movement', '⚡', { target: 40, unit: 'jumps', messages: ['{habit}: {target} {unit} complete! Great energy and effort.'] });
    habit('run', 'Run', 'counter', 'Movement', '🏃', { target: 1, unit: 'km', messages: ['{habit}: {target} {unit} complete! Every step counted toward your goal.'] });
    habit('flute', 'Flute Practice', 'checklist', 'Music', '🎵', { items: items([['scale1', 'Scale 1'], ['scale2', 'Scale 2'], ['piece1', 'Piece 1'], ['piece2', 'Piece 2'], ['study1', 'Study 1']]), messages: ['{habit}: {item} complete! Well done for making time to practise.'] });
    habit('piano', 'Piano Practice', 'checklist', 'Music', '🎹', { items: items([['piece1', 'Piece 1'], ['piece2', 'Piece 2'], ['piece3', 'Piece 3'], ['piece4', 'Piece 4']]), messages: ['{habit}: {item} complete! Keep building your rhythm and expression.'] });
    habit('shineEyes', 'Shine the Eyes', 'checklist', 'Daily routine', '✨', { items: items([['session1', 'Session 1'], ['session2', 'Session 2']]) });
    habit('vitamin', 'Vitamin Tablets', 'checklist', 'Daily routine', '☀️', { items: items([['dose1', 'Dose 1'], ['dose2', 'Dose 2']]) });
    habit('brushTeeth', 'Brush Teeth', 'checklist', 'Daily routine', '🪥', { items: items([['morning', 'Morning'], ['evening', 'Evening']]) });
    habit('probiotic', 'Probiotic', 'checklist', 'Daily routine', '🌿', { items: items([['dose1', 'Dose 1'], ['dose2', 'Dose 2']]) });
    const legacyFields = ['myobrace', 'exam1', 'exam2', 'bendDown', 'jumpUp', 'run', 'shineEyes1', 'shineEyes2', 'vitamin1', 'vitamin2', 'brushTeeth1', 'brushTeeth2', 'probiotic1', 'probiotic2'];
    const legacyDays = Object.keys(legacy);
    if (!legacyDays.length || legacyDays.some(key => !/^(?:[1-9]|1[0-6])$/.test(key))) fail('Legacy progress', 'must contain days numbered 1 to 16');
    const dates = calendar(data);
    for (const key of legacyDays) {
        const source = object(legacy[key], `Legacy day ${key}`);
        const path = `Legacy day ${key}`;
        for (const field of legacyFields) boolean(source[field], `${path}.${field}`);
        const flute = typeof source.flute === 'boolean' ? Array(5).fill(source.flute) : array(source.flute, `${path}.flute`, 5, 5);
        const piano = array(source.piano, `${path}.piano`, 4, 4);
        flute.forEach((value, index) => boolean(value, `${path}.flute[${index}]`));
        piano.forEach((value, index) => boolean(value, `${path}.piano[${index}]`));
        const date = dates[Number(key) - 1].key;
        for (const item of data.habits) {
            const entry = record(data, date, item);
            if (item.type === 'counter') entry.count = source[item.id] ? item.target : 0;
            if (item.id === 'exam') entry.items = { session1: source.exam1, session2: source.exam2 };
            if (item.id === 'flute' || item.id === 'piano') item.items.forEach((child, index) => { entry.items[child.id] = (item.id === 'flute' ? flute : piano)[index]; });
            if (['shineEyes', 'vitamin', 'brushTeeth', 'probiotic'].includes(item.id)) item.items.forEach((child, index) => { entry.items[child.id] = source[`${item.id}${index + 1}`]; });
            if (item.id === 'myobrace') {
                const remaining = number(source.myobraceSecondsLeft, `${path}.myobraceSecondsLeft`, 0, 7200, true);
                const running = boolean(source.myobraceRunning, `${path}.myobraceRunning`);
                const laps = array(source.myobraceLaps, `${path}.myobraceLaps`, LIMITS.laps).map((lap, index) => number(lap, `${path}.myobraceLaps[${index}]`, 0, 7200, true));
                if (source.myobrace && (running || remaining !== 0)) fail(path, 'has conflicting Myobrace completion values');
                if (!running && source.myobraceEndsAt != null) fail(path, 'has a deadline for a stopped Myobrace timer');
                const deadline = running ? (source.myobraceEndsAt == null ? now + remaining * 1000 : source.myobraceEndsAt) : null;
                if (deadline !== null) number(deadline, `${path}.myobraceEndsAt`, 1, 8640000000000000, true);
                entry.done = source.myobrace;
                entry.timer = { duration: 7200, remaining, endsAt: deadline, running, laps };
            }
        }
    }
    syncTimers(data, now);
    return validateData(data);
}


const TrackerModel = Object.freeze({ STORAGE_KEY, LIMITS, createDefaultData, migrateLegacy, validateData, dateKey, parseDate, calendar, isScheduled, record, getDayStats, getSummary, syncTimers, createHabit, uid });
export { STORAGE_KEY, LIMITS, createDefaultData, migrateLegacy, validateData, dateKey, parseDate, calendar, isScheduled, record, getDayStats, getSummary, syncTimers, createHabit, uid };
export default TrackerModel;
