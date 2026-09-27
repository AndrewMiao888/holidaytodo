import Model from './tracker-model.mjs';
import { adoptPersonalDefault } from './personal-default.mjs';

const BACKUP_FORMAT = 'holiday-habit-tracker';
const BACKUP_VERSION = 2;
const MAX_DATE = 253402300799999;

function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
    return value;
}

function timestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DATE) throw new Error('The current time is invalid.');
    return value;
}

function exportTime(value, now) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        throw new Error('The backup must include a valid export date.');
    }
    Model.parseDate(value.slice(0, 10));
    const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
    const parsed = Date.parse(value);
    if (hour > 23 || minute > 59 || second > 59 || !Number.isFinite(parsed) || parsed < 0 || parsed > now + 60000) {
        throw new Error('The backup export date is invalid or in the future. Check your device clock.');
    }
    return parsed;
}

function legacyDays(value) {
    plainObject(value, 'Legacy progress');
    const keys = Object.keys(value);
    if (keys.length !== 16 || keys.some(key => !/^(?:[1-9]|1[0-6])$/.test(key))) {
        throw new Error('A legacy backup must include all 16 days.');
    }
    for (let day = 1; day <= 16; day++) {
        if (!Object.prototype.hasOwnProperty.call(value, day)) throw new Error(`Legacy day ${day} is missing.`);
        plainObject(value[day], `Legacy day ${day}`);
    }
    return value;
}

function createBackup(data, now = Date.now()) {
    timestamp(now);
    const normalized = Model.validateData(data);
    Model.syncTimers(normalized, now);
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date(now).toISOString(),
        data: normalized
    };
}

function parseBackup(payload, now = Date.now(), legacyBackground = 'auto') {
    timestamp(now);
    plainObject(payload, 'Backup');
    let data;
    if (payload.format === BACKUP_FORMAT) {
        if (payload.version !== 1 && payload.version !== BACKUP_VERSION) throw new Error('This backup version is not supported.');
        const exportedAt = exportTime(payload.exportedAt, now);
        if (payload.version === BACKUP_VERSION) {
            data = Model.validateData(payload.data);
        } else {
            if (typeof payload.background !== 'string') throw new Error('The legacy backup has no valid background choice.');
            data = adoptPersonalDefault(Model.migrateLegacy(legacyDays(payload.days), payload.background, false, exportedAt));
        }
    } else if (Object.prototype.hasOwnProperty.call(payload, 'format')) {
        throw new Error('This file is not a Habit Tracker backup.');
    } else {
        data = adoptPersonalDefault(Model.migrateLegacy(legacyDays(payload), legacyBackground, false, now));
    }
    Model.syncTimers(data, now);
    return data;
}

export { BACKUP_FORMAT, BACKUP_VERSION, createBackup, parseBackup };
export default Object.freeze({ createBackup, parseBackup });
