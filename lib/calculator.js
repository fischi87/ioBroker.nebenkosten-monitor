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

module.exports = {
    convertGasM3ToKWh,
    getCurrentPrice,
    calculateCost,
    roundToDecimals,
};
