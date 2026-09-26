// Portable backups contain only this challenge's progress and background choice.
const TRACKER_BACKUP_FORMAT = 'holiday-habit-tracker';
const TRACKER_BACKUP_VERSION = 1;
const TRACKER_BACKUP_STATE_KEY = 'holiday_habit_tracker_v4';
const TRACKER_BACKUP_MAX_BYTES = 1024 * 1024;
let trackerBackupRestoreInProgress = false;

function setBackupStatus(message, isError = false) {
    const status = document.getElementById('backup-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(isError);
}

function isBackupRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBackupDays(days, referenceTime, now) {
    if (!isBackupRecord(days) || Object.keys(days).length !== TOTAL_DAYS) {
        throw new Error(`The backup must include all ${TOTAL_DAYS} days.`);
    }

    const booleanFields = [
        'myobrace', 'exam1', 'exam2', 'bendDown', 'jumpUp', 'run',
        'shineEyes1', 'shineEyes2', 'vitamin1', 'vitamin2',
        'brushTeeth1', 'brushTeeth2', 'probiotic1', 'probiotic2'
    ];
    const normalized = {};
    const validSeconds = value => Number.isInteger(value) && value >= 0 && value <= MYOBRACE_DURATION;

    for (let number = 1; number <= TOTAL_DAYS; number++) {
        if (!Object.prototype.hasOwnProperty.call(days, number) || !isBackupRecord(days[number])) {
            throw new Error(`Day ${number} is missing or invalid.`);
        }
        const source = days[number];
        const day = {};
        for (const field of booleanFields) {
            if (typeof source[field] !== 'boolean') {
                throw new Error(`Day ${number} has an invalid task value (${field}).`);
            }
            day[field] = source[field];
        }

        for (const [field, count] of [['piano', 4], ['flute', 5]]) {
            // Earlier tracker versions used a single checkbox for all flute practice.
            const checks = field === 'flute' && typeof source.flute === 'boolean'
                ? Array(count).fill(source.flute)
                : source[field];
            if (!Array.isArray(checks) || checks.length !== count || checks.some(value => typeof value !== 'boolean')) {
                throw new Error(`Day ${number} must have ${count} valid ${field} checkboxes.`);
            }
            day[field] = checks.slice();
        }

        if (!validSeconds(source.myobraceSecondsLeft) || typeof source.myobraceRunning !== 'boolean') {
            throw new Error(`Day ${number} has invalid timer values.`);
        }
        if (!Array.isArray(source.myobraceLaps) || source.myobraceLaps.some(value => !validSeconds(value))) {
            throw new Error(`Day ${number} has invalid timer laps.`);
        }
        day.myobraceSecondsLeft = source.myobraceSecondsLeft;
        day.myobraceRunning = source.myobraceRunning;
        day.myobraceLaps = source.myobraceLaps.slice();
        day.myobraceEndsAt = null;

        if (day.myobrace && (day.myobraceRunning || day.myobraceSecondsLeft !== 0)) {
            throw new Error(`Day ${number} has conflicting timer completion values.`);
        }

        if (day.myobraceRunning) {
            const deadline = source.myobraceEndsAt == null
                ? referenceTime + day.myobraceSecondsLeft * 1000
                : source.myobraceEndsAt;
            if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > now + (MYOBRACE_DURATION + 60) * 1000) {
                throw new Error(`Day ${number} has an invalid timer deadline.`);
            }
            day.myobraceEndsAt = deadline;
            day.myobraceSecondsLeft = Math.min(MYOBRACE_DURATION, Math.max(0, Math.ceil((deadline - now) / 1000)));
            if (day.myobraceSecondsLeft === 0) {
                day.myobrace = true;
                day.myobraceRunning = false;
                day.myobraceEndsAt = null;
            }
        } else if (source.myobraceEndsAt != null) {
            throw new Error(`Day ${number} has a deadline for a stopped timer.`);
        }

        normalized[number] = day;
    }
    return normalized;
}

function validateTrackerBackup(payload, now = Date.now()) {
    if (!isBackupRecord(payload)) throw new Error('Choose a valid tracker JSON backup.');

    let days;
    let background;
    let referenceTime = now;
    if (payload.format === TRACKER_BACKUP_FORMAT) {
        if (payload.version !== TRACKER_BACKUP_VERSION) throw new Error('This backup version is not supported.');
        referenceTime = typeof payload.exportedAt === 'string' ? Date.parse(payload.exportedAt) : NaN;
        if (!Number.isFinite(referenceTime) || referenceTime > now + 60000) {
            throw new Error('The backup date is invalid or in the future. Check your device clock.');
        }
        days = payload.days;
        background = payload.background;
    } else if (Object.prototype.hasOwnProperty.call(payload, '1')) {
        // Raw saved progress from older versions has no background or export date.
        days = payload;
        background = selectedBackground;
    } else {
        throw new Error('This file is not a Holiday Habit Tracker backup.');
    }

    if (typeof background !== 'string' || (background !== 'auto' && !backgroundGradients.some(item => item.id === background))) {
        throw new Error('The backup has an unknown background choice.');
    }
    return { days: validateBackupDays(days, referenceTime, now), background };
}

function downloadBackup() {
    let downloadUrl;
    try {
        const now = Date.now();
        const backup = {
            format: TRACKER_BACKUP_FORMAT,
            version: TRACKER_BACKUP_VERSION,
            exportedAt: new Date(now).toISOString(),
            days: validateBackupDays(trackerState, now, now),
            background: selectedBackground
        };
        const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        if (file.size > TRACKER_BACKUP_MAX_BYTES) throw new Error('This backup is larger than the 1 MB limit.');
        downloadUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `holiday-tracker-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setBackupStatus(`Backup download started. It includes all ${TOTAL_DAYS} days and your background.`);
    } catch (error) {
        setBackupStatus(`Could not create the backup. ${error.message}`, true);
    } finally {
        if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
}

function persistTrackerBackup(days, background) {
    // Read both previous values before writing, so a failed write can be rolled back.
    const previousState = localStorage.getItem(TRACKER_BACKUP_STATE_KEY);
    const previousBackground = localStorage.getItem(BACKGROUND_KEY);
    let stateWritten = false;
    let backgroundWritten = false;
    try {
        localStorage.setItem(TRACKER_BACKUP_STATE_KEY, JSON.stringify(days));
        stateWritten = true;
        localStorage.setItem(BACKGROUND_KEY, background);
        backgroundWritten = true;
    } catch (error) {
        try {
            if (stateWritten) {
                if (previousState === null) localStorage.removeItem(TRACKER_BACKUP_STATE_KEY);
                else localStorage.setItem(TRACKER_BACKUP_STATE_KEY, previousState);
            }
            if (backgroundWritten) {
                if (previousBackground === null) localStorage.removeItem(BACKGROUND_KEY);
                else localStorage.setItem(BACKGROUND_KEY, previousBackground);
            }
        } catch (rollbackError) {
            throw new Error('Browser storage failed while restoring. The current on-screen progress is unchanged; download it before reloading.');
        }
        throw new Error('Your browser could not save the backup. Your current progress has not been replaced.');
    }
}

async function restoreBackup(input) {
    if (trackerBackupRestoreInProgress) return;
    const file = input && input.files && input.files[0];
    if (!file) return;
    trackerBackupRestoreInProgress = true;
    let restored;
    try {
        if (file.size > TRACKER_BACKUP_MAX_BYTES) throw new Error('Choose a JSON backup smaller than 1 MB.');
        if (file.size === 0) throw new Error('The selected file is empty.');
        setBackupStatus('Checking your backup...');
        const contents = await file.text();
        let payload;
        try {
            payload = JSON.parse(contents);
        } catch (error) {
            throw new Error('The selected file is not valid JSON.');
        }
        restored = validateTrackerBackup(payload);
        if (!confirm(`Restore this backup? It will replace progress for all ${TOTAL_DAYS} days and the background choice. Download your current backup first if you want to keep it.`)) {
            setBackupStatus('Restore cancelled. Your current progress is unchanged.');
            return;
        }
        // Account for time spent reading the confirmation without restarting timers.
        restored.days = validateBackupDays(restored.days, Date.now(), Date.now());
        persistTrackerBackup(restored.days, restored.background);
    } catch (error) {
        setBackupStatus(`Could not restore the backup. ${error.message}`, true);
        return;
    } finally {
        input.value = '';
        trackerBackupRestoreInProgress = false;
    }

    trackerState = restored.days;
    selectedBackground = restored.background;
    try {
        applyTimeTheme();
        renderBackgroundOptions();
        renderTabs();
        renderDayContent();
        updateOverallStats();
        setBackupStatus(`Backup restored. All ${TOTAL_DAYS} days and your background are saved.`);
    } catch (error) {
        setBackupStatus('Your backup was saved, but the display could not refresh. Reload the page to show the restored progress.', true);
    }
}
