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
 * Gets the current price for a specific date from price history
 *
 * @param {Array} priceHistory - Array of price objects with {validFrom, price, basicCharge}
 * @param {Date|string} date - Date to get price for (defaults to now)
 * @returns {object|null} Price object {price, basicCharge} or null if not found
 */
function getCurrentPrice(priceHistory, date = new Date()) {
    if (!Array.isArray(priceHistory) || priceHistory.length === 0) {
        return null;
    }

    const targetDate = new Date(date);

    // Sort by validFrom date (newest first)
    const sorted = [...priceHistory].sort((a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime());

    // Find the first price that is valid for the target date
    for (const priceEntry of sorted) {
        const validFrom = new Date(priceEntry.validFrom);
        if (validFrom <= targetDate) {
            return {
                price: priceEntry.price,
                basicCharge: priceEntry.basicCharge || 0,
            };
        }
    }

    return null;
}

/**
 * Calculates cost for a consumption value using current price
 *
 * @param {number} consumption - Consumption in kWh or m³
 * @param {Array} priceHistory - Price history array
 * @param {Date|string} date - Date for price lookup (defaults to now)
 * @returns {number} Cost in €
 */
function calculateCost(consumption, priceHistory, date = new Date()) {
    if (typeof consumption !== 'number' || consumption < 0) {
        throw new TypeError('Consumption must be a non-negative number');
    }

    const currentPrice = getCurrentPrice(priceHistory, date);
    if (!currentPrice) {
        return 0;
    }

    return consumption * currentPrice.price;
}

/**
 * Calculates monthly basic charge
 *
 * @param {Array} priceHistory - Price history array
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {number} Monthly basic charge in €
 */
function getMonthlyBasicCharge(priceHistory, month, year) {
    const date = new Date(year, month - 1, 15); // Mid-month
    const currentPrice = getCurrentPrice(priceHistory, date);
    return currentPrice ? currentPrice.basicCharge : 0;
}

/**
 * Calculates total cost including basic charges for a time period
 * Handles price changes within the period
 *
 * @param {number} totalConsumption - Total consumption in the period
 * @param {Array} priceHistory - Price history array
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @returns {object} {consumptionCost, basicCharge, total}
 */
function calculatePeriodCost(totalConsumption, priceHistory, startDate, endDate) {
    if (!priceHistory || priceHistory.length === 0) {
        return { consumptionCost: 0, basicCharge: 0, total: 0 };
    }

    // Use average price for the period (simplified)
    const midPoint = new Date((startDate.getTime() + endDate.getTime()) / 2);
    const currentPrice = getCurrentPrice(priceHistory, midPoint);

    if (!currentPrice) {
        return { consumptionCost: 0, basicCharge: 0, total: 0 };
    }

    const consumptionCost = totalConsumption * currentPrice.price;

    // Calculate basic charge for the period
    const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const months = days / 30;
    const basicCharge = currentPrice.basicCharge * months;

    return {
        consumptionCost,
        basicCharge,
        total: consumptionCost + basicCharge,
    };
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
    getMonthlyBasicCharge,
    calculatePeriodCost,
    roundToDecimals,
};
