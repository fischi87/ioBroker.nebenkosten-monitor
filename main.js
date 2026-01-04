'use strict';

/*
 * ioBroker Nebenkosten-Monitor Adapter
 * Monitors gas, water, and electricity consumption with cost calculation
 */

const utils = require('@iobroker/adapter-core');
const calculator = require('./lib/calculator');
const stateManager = require('./lib/stateManager');

class NebenkostenMonitor extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    constructor(options) {
        super({
            ...options,
            name: 'nebenkosten-monitor',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        // Internal state tracking
        this.lastSensorValues = {};
        this.periodicTimers = {};
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.log.info('Nebenkosten-Monitor starting...');

        // Initialize each utility type based on configuration
        await this.initializeUtility('gas', this.config.gasAktiv);
        await this.initializeUtility('water', this.config.wasserAktiv);
        await this.initializeUtility('electricity', this.config.stromAktiv);

        // Set up periodic tasks
        this.setupPeriodicTasks();

        this.log.info('Nebenkosten-Monitor initialized successfully');
    }

    /**
     * Initializes a utility type (gas, water, or electricity)
     *
     * @param {string} type - Utility type
     * @param {boolean} isActive - Whether this utility is active
     */
    async initializeUtility(type, isActive) {
        if (!isActive) {
            this.log.debug(`${type} monitoring is disabled`);
            // Clean up states if utility was disabled
            await stateManager.deleteUtilityStateStructure(this, type);
            return;
        }

        this.log.info(`Initializing ${type} monitoring...`);

        // Create state structure
        await stateManager.createUtilityStateStructure(this, type);

        // Get sensor datapoint from config
        const sensorDPKey = `${type}SensorDP`;
        const sensorDP = this.config[sensorDPKey];

        if (!sensorDP) {
            this.log.warn(`${type} is active but no sensor datapoint configured!`);
            await this.setStateAsync(`${type}.info.sensorActive`, false, true);
            return;
        }

        this.log.debug(`Using sensor datapoint for ${type}: ${sensorDP}`);

        // Subscribe to sensor datapoint
        this.subscribeForeignStates(sensorDP);
        await this.setStateAsync(`${type}.info.sensorActive`, true, true);
        this.log.debug(`Subscribed to ${type} sensor: ${sensorDP}`);

        // Initialize with current sensor value
        try {
            const sensorState = await this.getForeignStateAsync(sensorDP);
            if (sensorState && sensorState.val !== null && typeof sensorState.val === 'number') {
                await this.handleSensorUpdate(type, sensorDP, sensorState.val);
            }
        } catch (error) {
            this.log.warn(`Could not read initial value from ${sensorDP}: ${error.message}`);
        }

        // Initialize period start timestamps if not set
        const now = Date.now();
        const dayStart = await this.getStateAsync(`${type}.statistics.lastDayStart`);
        if (!dayStart || !dayStart.val) {
            await this.setStateAsync(`${type}.statistics.lastDayStart`, now, true);
        }

        const monthStart = await this.getStateAsync(`${type}.statistics.lastMonthStart`);
        if (!monthStart || !monthStart.val) {
            await this.setStateAsync(`${type}.statistics.lastMonthStart`, now, true);
        }

        const yearStart = await this.getStateAsync(`${type}.statistics.lastYearStart`);
        if (!yearStart || !yearStart.val) {
            // Use earliest price date as year start
            const pricesKey = `${type}Preise`;
            const prices = this.config[pricesKey] || [];
            let yearStartDate = new Date(new Date().getFullYear(), 0, 1);

            if (prices.length > 0) {
                const sortedPrices = [...prices].sort(
                    (a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime(),
                );
                yearStartDate = new Date(sortedPrices[0].validFrom);
            }

            await this.setStateAsync(`${type}.statistics.lastYearStart`, yearStartDate.getTime(), true);
            this.log.info(`Year start for ${type} set to ${yearStartDate.toISOString().split('T')[0]}`);
        }

        // Update current price
        await this.updateCurrentPrice(type);

        // Initial cost calculation (wichtig! Sonst bleiben Kosten bei 0)
        await this.updateCosts(type);

        // Initialize yearly consumption from initial reading if set
        const initialReadingKey = `${type}InitialReading`;
        const initialReading = this.config[initialReadingKey] || 0;

        if (initialReading > 0) {
            const sensorState = await this.getForeignStateAsync(sensorDP);
            if (sensorState && typeof sensorState.val === 'number') {
                let current = sensorState.val;

                // For gas: convert m³ to kWh first
                if (type === 'gas') {
                    const brennwert = this.config.gasBrennwert || 11.5;
                    const zZahl = this.config.gasZahl || 0.95;
                    current = calculator.convertGasM3ToKWh(current, brennwert, zZahl);
                }

                // Apply offset if configured
                const offsetKey = `${type}Offset`;
                const offset = this.config[offsetKey] || 0;
                if (offset !== 0) {
                    current = current + offset;
                }

                // Calculate yearly consumption: Current - Initial
                const yearlyFromInitial = Math.max(0, current - initialReading);
                await this.setStateAsync(`${type}.consumption.yearly`, yearlyFromInitial, true);
                await this.updateCosts(type); // Recalculate costs with yearly value
                this.log.info(
                    `Init yearly ${type}: ${yearlyFromInitial.toFixed(2)} (current: ${current.toFixed(2)}, initial: ${initialReading})`,
                );
            }
        }

        this.log.debug(`Initial cost calculation completed for ${type}`);
    }

    /**
     * Handles sensor value updates
     *
     * @param {string} type - Utility type
     * @param {string} sensorDP - Sensor datapoint ID
     * @param {number} value - New sensor value
     */
    async handleSensorUpdate(type, sensorDP, value) {
        if (typeof value !== 'number' || value < 0) {
            this.log.warn(`Invalid sensor value for ${type}: ${value}`);
            return;
        }

        this.log.debug(`Sensor update for ${type}: ${value}`);

        const now = Date.now();
        let consumption = value;

        // For gas, convert m³ to kWh
        if (type === 'gas') {
            const brennwert = this.config.gasBrennwert || 11.5;
            const zZahl = this.config.gasZahl || 0.95;

            // Store volume reading
            await this.setStateAsync(`${type}.info.meterReadingVolume`, value, true);

            // Convert to kWh
            consumption = calculator.convertGasM3ToKWh(value, brennwert, zZahl);
            consumption = calculator.roundToDecimals(consumption, 2);

            this.log.debug(
                `Gas conversion: ${value} m³ → ${consumption} kWh (Brennwert: ${brennwert}, Z-Zahl: ${zZahl})`,
            );
        }

        // Apply offset if configured
        const offsetKey = `${type}Offset`;
        const offset = this.config[offsetKey] || 0;
        if (offset !== 0) {
            consumption = consumption + offset;
            this.log.debug(`Applied offset for ${type}: ${offset}, new value: ${consumption}`);
        }

        // Update meter reading (in kWh for gas, m³ for water, kWh for electricity)
        await this.setStateAsync(`${type}.info.meterReading`, consumption, true);

        // Calculate deltas if we have a previous value
        const lastValue = this.lastSensorValues[sensorDP];
        if (lastValue !== undefined && consumption > lastValue) {
            const delta = consumption - lastValue;
            this.log.debug(`${type} delta: ${delta}`);

            // Update daily consumption
            const dailyConsumption = await this.getStateAsync(`${type}.consumption.daily`);
            const newDaily = (typeof dailyConsumption?.val === 'number' ? dailyConsumption.val : 0) + delta;
            await this.setStateAsync(`${type}.consumption.daily`, calculator.roundToDecimals(newDaily, 2), true);

            // Update monthly consumption
            const monthlyConsumption = await this.getStateAsync(`${type}.consumption.monthly`);
            const newMonthly = (typeof monthlyConsumption?.val === 'number' ? monthlyConsumption.val : 0) + delta;
            await this.setStateAsync(`${type}.consumption.monthly`, calculator.roundToDecimals(newMonthly, 2), true);

            // Update yearly consumption
            // If initial reading is set, calculate from initial, otherwise use delta accumulation
            const initialReadingKey = `${type}InitialReading`;
            const initialReading = this.config[initialReadingKey] || 0;

            if (initialReading > 0) {
                // Calculate yearly as: Current - Initial
                const yearlyFromInitial = Math.max(0, consumption - initialReading);
                await this.setStateAsync(
                    `${type}.consumption.yearly`,
                    calculator.roundToDecimals(yearlyFromInitial, 2),
                    true,
                );
                this.log.debug(
                    `Yearly ${type} from initial: ${yearlyFromInitial} (current: ${consumption}, initial: ${initialReading})`,
                );
            } else {
                // Fallback: Accumulate deltas
                const yearlyConsumption = await this.getStateAsync(`${type}.consumption.yearly`);
                const newYearly = (typeof yearlyConsumption?.val === 'number' ? yearlyConsumption.val : 0) + delta;
                await this.setStateAsync(`${type}.consumption.yearly`, calculator.roundToDecimals(newYearly, 2), true);
            }

            // Recalculate costs
            await this.updateCosts(type);
        }

        // Store current value and update timestamp
        this.lastSensorValues[sensorDP] = consumption;
        await this.setStateAsync(`${type}.consumption.current`, consumption, true);
        await this.setStateAsync(`${type}.consumption.lastUpdate`, now, true);
        await this.setStateAsync(`${type}.info.lastSync`, now, true);
    }

    /**
     * Updates cost calculations for a utility type
     *
     * @param {string} type - Utility type
     */
    async updateCosts(type) {
        const pricesKey = `${type}Preise`;
        const priceHistory = this.config[pricesKey] || [];

        if (!priceHistory || priceHistory.length === 0) {
            this.log.debug(`No price history configured for ${type}`);
            return;
        }

        // Get current consumptions
        const dailyState = await this.getStateAsync(`${type}.consumption.daily`);
        const monthlyState = await this.getStateAsync(`${type}.consumption.monthly`);
        const yearlyState = await this.getStateAsync(`${type}.consumption.yearly`);

        const daily = typeof dailyState?.val === 'number' ? dailyState.val : 0;
        const monthly = typeof monthlyState?.val === 'number' ? monthlyState.val : 0;
        const yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;

        // Calculate costs
        const dailyCost = calculator.calculateCost(daily, priceHistory);
        const monthlyCost = calculator.calculateCost(monthly, priceHistory);
        const yearlyCost = calculator.calculateCost(yearly, priceHistory);

        // Get basic charge
        const currentPrice = calculator.getCurrentPrice(priceHistory);
        const basicCharge = currentPrice?.basicCharge || 0;

        // Update cost states
        await this.setStateAsync(`${type}.costs.daily`, calculator.roundToDecimals(dailyCost, 2), true);
        await this.setStateAsync(`${type}.costs.monthly`, calculator.roundToDecimals(monthlyCost, 2), true);
        await this.setStateAsync(`${type}.costs.yearly`, calculator.roundToDecimals(yearlyCost, 2), true);
        await this.setStateAsync(`${type}.costs.basicCharge`, calculator.roundToDecimals(basicCharge, 2), true);

        // Total costs = consumption costs + basic charge (yearly)
        const totalCost = yearlyCost + basicCharge * 12; // Yearly total
        await this.setStateAsync(`${type}.costs.total`, calculator.roundToDecimals(totalCost, 2), true);

        // Abschlag Calculation
        const abschlagKey = `${type}Abschlag`;
        const monthlyAbschlag = this.config[abschlagKey] || 0;

        if (monthlyAbschlag > 0) {
            const yearStartState = await this.getStateAsync(`${type}.statistics.lastYearStart`);
            const yearStartTime = typeof yearStartState?.val === 'number' ? yearStartState.val : Date.now();
            const monthsSinceYear = Math.max(1, Math.ceil((Date.now() - yearStartTime) / (1000 * 60 * 60 * 24 * 30)));

            const paidTotal = monthlyAbschlag * monthsSinceYear;
            const consumedCostSoFar = yearlyCost + basicCharge * monthsSinceYear;
            const balance = paidTotal - consumedCostSoFar;

            await this.setStateAsync(`${type}.costs.paidTotal`, calculator.roundToDecimals(paidTotal, 2), true);
            await this.setStateAsync(`${type}.costs.balance`, calculator.roundToDecimals(balance, 2), true);

            this.log.debug(`Abschlag ${type}: Paid=${paidTotal}€, Balance=${balance}€`);
        } else {
            await this.setStateAsync(`${type}.costs.paidTotal`, 0, true);
            await this.setStateAsync(`${type}.costs.balance`, 0, true);
        }

        this.log.debug(
            `Updated costs for ${type}: daily=${dailyCost}€, monthly=${monthlyCost}€, yearly=${yearlyCost}€`,
        );
    }

    /**
     * Updates the current price display
     *
     * @param {string} type - Utility type
     */
    async updateCurrentPrice(type) {
        const pricesKey = `${type}Preise`;
        const priceHistory = this.config[pricesKey] || [];

        const currentPrice = calculator.getCurrentPrice(priceHistory);
        if (currentPrice) {
            await this.setStateAsync(
                `${type}.info.currentPrice`,
                calculator.roundToDecimals(currentPrice.price, 4),
                true,
            );
        }
    }

    /**
     * Resets daily counters (called at midnight)
     *
     * @param {string} type - Utility type
     */
    async resetDailyCounters(type) {
        this.log.info(`Resetting daily counter for ${type}`);

        // Get current daily consumption for statistics
        const dailyState = await this.getStateAsync(`${type}.consumption.daily`);
        const dailyValue = typeof dailyState?.val === 'number' ? dailyState.val : 0;

        // Reset daily consumption
        await this.setStateAsync(`${type}.consumption.daily`, 0, true);
        await this.setStateAsync(`${type}.costs.daily`, 0, true);
        await this.setStateAsync(`${type}.statistics.lastDayStart`, Date.now(), true);

        // Update average
        // TODO: Store history and calculate proper average
        await this.setStateAsync(`${type}.statistics.averageDaily`, calculator.roundToDecimals(dailyValue, 2), true);
    }

    /**
     * Resets monthly counters (called on first of month)
     *
     * @param {string} type - Utility type
     */
    async resetMonthlyCounters(type) {
        this.log.info(`Resetting monthly counter for ${type}`);

        // Get current monthly consumption for statistics
        const monthlyState = await this.getStateAsync(`${type}.consumption.monthly`);
        const monthlyValue = typeof monthlyState?.val === 'number' ? monthlyState.val : 0;

        // Reset monthly consumption
        await this.setStateAsync(`${type}.consumption.monthly`, 0, true);
        await this.setStateAsync(`${type}.costs.monthly`, 0, true);
        await this.setStateAsync(`${type}.statistics.lastMonthStart`, Date.now(), true);

        // Update average
        await this.setStateAsync(
            `${type}.statistics.averageMonthly`,
            calculator.roundToDecimals(monthlyValue, 2),
            true,
        );
    }

    /**
     * Resets yearly counters (called on January 1st)
     *
     * @param {string} type - Utility type
     */
    async resetYearlyCounters(type) {
        this.log.info(`Resetting yearly counter for ${type}`);

        // Reset yearly consumption
        await this.setStateAsync(`${type}.consumption.yearly`, 0, true);
        await this.setStateAsync(`${type}.costs.yearly`, 0, true);
        await this.setStateAsync(`${type}.costs.total`, 0, true);
        await this.setStateAsync(`${type}.statistics.lastYearStart`, Date.now(), true);
    }

    /**
     * Sets up periodic tasks (daily reset, etc.)
     */
    setupPeriodicTasks() {
        // Check every minute for period changes
        this.periodicTimers.checkPeriods = setInterval(async () => {
            await this.checkPeriodResets();
        }, 60000); // Every minute

        // Initial check
        this.checkPeriodResets();
    }

    /**
     * Checks if any period resets are needed
     */
    async checkPeriodResets() {
        const now = new Date();
        const types = ['gas', 'water', 'electricity'];

        for (const type of types) {
            const activeKey = `${type}Aktiv`;
            if (!this.config[activeKey]) {
                continue;
            }

            // Check daily reset (midnight)
            const lastDayStart = await this.getStateAsync(`${type}.statistics.lastDayStart`);
            if (lastDayStart?.val && typeof lastDayStart.val === 'number') {
                const lastDay = new Date(lastDayStart.val);
                if (now.getDate() !== lastDay.getDate() && now.getHours() === 0 && now.getMinutes() === 0) {
                    await this.resetDailyCounters(type);
                }
            }

            // Check monthly reset (1st of month)
            const lastMonthStart = await this.getStateAsync(`${type}.statistics.lastMonthStart`);
            if (lastMonthStart?.val && typeof lastMonthStart.val === 'number') {
                const lastMonth = new Date(lastMonthStart.val);
                if (now.getMonth() !== lastMonth.getMonth() && now.getDate() === 1 && now.getHours() === 0) {
                    await this.resetMonthlyCounters(type);
                }
            }

            // Check yearly reset (January 1st)
            const lastYearStart = await this.getStateAsync(`${type}.statistics.lastYearStart`);
            if (lastYearStart?.val && typeof lastYearStart.val === 'number') {
                const lastYear = new Date(lastYearStart.val);
                if (now.getFullYear() !== lastYear.getFullYear() && now.getMonth() === 0 && now.getDate() === 1) {
                    await this.resetYearlyCounters(type);
                }
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback - Callback function
     */
    onUnload(callback) {
        try {
            this.log.info('Nebenkosten-Monitor shutting down...');

            // Clear all timers
            Object.values(this.periodicTimers).forEach(timer => {
                if (timer) {
                    clearInterval(timer);
                }
            });

            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${error.message}`);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id - State ID
     * @param {ioBroker.State | null | undefined} state - State object
     */
    async onStateChange(id, state) {
        if (!state || state.ack === true) {
            // We only care about sensor updates from foreign adapters
            return;
        }

        // Determine which utility this sensor belongs to
        const utilities = [
            { type: 'gas', activeKey: 'gasAktiv', sensorKey: 'gasSensorDP' },
            { type: 'water', activeKey: 'wasserAktiv', sensorKey: 'wasserSensorDP' },
            { type: 'electricity', activeKey: 'stromAktiv', sensorKey: 'stromSensorDP' },
        ];

        for (const utility of utilities) {
            if (this.config[utility.activeKey] && this.config[utility.sensorKey] === id) {
                if (typeof state.val === 'number') {
                    await this.handleSensorUpdate(utility.type, id, state.val);
                }
                break;
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    module.exports = options => new NebenkostenMonitor(options);
} else {
    // otherwise start the instance directly
    new NebenkostenMonitor();
}
