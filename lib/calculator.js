/**
 * Calculator module for nebenkosten-monitor
 * Provides utility functions for gas conversion, cost calculation, and consumption aggregation
 */

/**
 * Converts gas volume from m³ to kWh
 * Formula: kWh = m³ × Brennwert × Z-Zahl
 *
 * @param {number} m3 - Volume in cubic meters
 * @param {number} brennwert - Calorific value (typically ~11.5 kWh/m³)
 * @param {number} zZahl - Z-number/state number (typically ~0.95)
 * @returns {number} Energy in kWh
 */
function convertGasM3ToKWh(m3, brennwert = 11.5, zZahl = 0.95) {
    if (typeof m3 !== 'number' || typeof brennwert !== 'number' || typeof zZahl !== 'number') {
        throw new TypeError('All parameters must be numbers');
    }
    if (m3 < 0 || brennwert <= 0 || zZahl <= 0 || zZahl > 1) {
        throw new RangeError('Invalid parameter values');
    }
    return m3 * brennwert * zZahl;
}

/**
 * Gets the current price - simplified version
 *
 * @param {number} price - Current price per unit
 * @param {number} basicCharge - Basic charge per month
 * @returns {object} Price object {price, basicCharge}
 */
function getCurrentPrice(price, basicCharge = 0) {
    return {
        price: price || 0,
        basicCharge: basicCharge || 0,
    };
}

/**
 * Calculates cost for a consumption value using current price
 *
 * @param {number} consumption - Consumption in kWh or m³
 * @param {number} price - Current price per unit
 * @returns {number} Cost in €
 */
function calculateCost(consumption, price) {
    if (typeof consumption !== 'number' || consumption < 0) {
        throw new TypeError('Consumption must be a non-negative number');
    }

    return consumption * (price || 0);
}

/**
 * Rounds a number to specified decimal places
 *
 * @param {number} value - Value to round
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Rounded value
 */
function roundToDecimals(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/**
 * Parses a German date string (DD.MM.YYYY) into a Date object
 *
 * @param {string} dateStr - Date string in format DD.MM.YYYY
 * @returns {Date|null} Date object or null if invalid
 */
function parseGermanDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return null;
    }
    const parts = dateStr.trim().split('.');
    if (parts.length !== 3) {
        return null;
    }
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    let year = parseInt(parts[2], 10);

    // Handle 2-digit years (e.g. 25 -> 2025)
    if (year < 100) {
        year += 2000;
    }

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
        return null;
    }

    // Create date at noon to avoid timezone shift issues (especially with ISO export)
    return new Date(year, month, day, 12, 0, 0);
}

/**
 * Checks if the current time is within the High Tariff (HT) period
 *
 * @param {object} config - Adapter configuration
 * @param {string} type - Utility type: 'gas' or 'strom'
 * @returns {boolean} True if current time is HT, false if NT
 */
function isHTTime(config, type) {
    if (!config || !type) {
        return true;
    }

    const enabled = config[`${type}HtNtEnabled`];
    if (!enabled) {
        return true;
    }

    const startTimeStr = config[`${type}HtStart`];
    const endTimeStr = config[`${type}HtEnd`];

    if (!startTimeStr || !endTimeStr) {
        return true;
    }

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeMinutes = currentHours * 60 + currentMinutes;

    const [startH, startM] = startTimeStr.split(':').map(val => parseInt(val, 10));
    const [endH, endM] = endTimeStr.split(':').map(val => parseInt(val, 10));

    const startTimeMinutes = startH * 60 + (startM || 0);
    const endTimeMinutes = endH * 60 + (endM || 0);

    if (startTimeMinutes <= endTimeMinutes) {
        // HT period during the day (e.g. 06:00 - 22:00)
        return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
    }

    // HT period over midnight (e.g. 22:00 - 06:00)
    return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes;
}

module.exports = {
    convertGasM3ToKWh,
    getCurrentPrice,
    calculateCost,
    roundToDecimals,
    parseGermanDate,
    isHTTime,
};
