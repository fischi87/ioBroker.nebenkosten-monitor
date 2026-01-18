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

/**
 * Validates if a sensor datapoint ID exists and is valid
 *
 * @param {string} sensorDP - Sensor datapoint ID
 * @returns {boolean} - True if valid
 */
function isValidSensorDP(sensorDP) {
    if (!sensorDP || typeof sensorDP !== 'string') {
        return false;
    }
    // Basic validation: should contain at least one dot and not be empty
    return sensorDP.trim().length > 0 && sensorDP.includes('.');
}

/**
 * Validates and parses a date string
 *
 * @param {string} dateStr - Date string
 * @param {string} defaultValue - Default value if parsing fails
 * @returns {string} - Validated date string or default
 */
function parseConfigDate(dateStr, defaultValue = '') {
    if (!dateStr || typeof dateStr !== 'string') {
        return defaultValue;
    }

    const trimmed = dateStr.trim();
    if (trimmed.length === 0) {
        return defaultValue;
    }

    // German date format: DD.MM.YYYY
    const germanDateRegex = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;
    // ISO date format: YYYY-MM-DD
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (germanDateRegex.test(trimmed) || isoDateRegex.test(trimmed)) {
        return trimmed;
    }

    return defaultValue;
}

/**
 * Validates a price/cost value (must be non-negative)
 *
 * @param {any} value - Price value
 * @param {number} defaultValue - Default value
 * @returns {number} - Validated price
 */
function parseConfigPrice(value, defaultValue = 0) {
    const parsed = parseConfigNumber(value, defaultValue);
    // Prices cannot be negative
    return parsed < 0 ? defaultValue : parsed;
}

module.exports = {
    parseConfigNumber,
    isValidSensorDP,
    parseConfigDate,
    parseConfigPrice,
};
