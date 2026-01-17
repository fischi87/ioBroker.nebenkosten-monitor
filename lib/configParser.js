'use strict';

/**
 * Parst einen Config-Wert sicher zu einer Zahl
 *
 * @param {any} value - Der zu parsende Wert
 * @param {number} defaultValue - Default-Wert wenn Parsing fehlschlägt
 * @returns {number} - Geparster Zahlenwert
 */
function parseConfigNumber(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }

    // Wenn es bereits eine Zahl ist
    if (typeof value === 'number') {
        return value;
    }

    // String zu Zahl konvertieren
    if (typeof value === 'string') {
        // Ersetze Komma durch Punkt für deutsche Dezimalzahlen
        const normalized = value.replace(',', '.');
        const parsed = parseFloat(normalized);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    return defaultValue;
}

module.exports = {
    parseConfigNumber,
};
