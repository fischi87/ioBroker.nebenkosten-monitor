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
        // Map German field names to English (config uses German, code uses English)
        const sensorDPMapping = {
            gas: 'gasSensorDP',
            water: 'wasserSensorDP',
            electricity: 'stromSensorDP',
        };

        const sensorDPKey = sensorDPMapping[type];
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
            // Set year start to January 1st of current year
            const yearStartDate = new Date(new Date().getFullYear(), 0, 1);
            await this.setStateAsync(`${type}.statistics.lastYearStart`, yearStartDate.getTime(), true);
            this.log.info(`Year start for ${type} set to ${yearStartDate.toISOString().split('T')[0]}`);
        }

        // Update current price
        await this.updateCurrentPrice(type);

        // Initial cost calculation (wichtig! Sonst bleiben Kosten bei 0)
        await this.updateCosts(type);

        // Initialize yearly consumption from initial reading if set
        // Map English type to German config names
        const typeMapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        const configType = typeMapping[type] || type;

        const initialReadingKey = `${configType}InitialReading`;
        const initialReading = this.config[initialReadingKey] || 0;

        if (initialReading > 0) {
            const sensorState = await this.getForeignStateAsync(sensorDP);
            if (sensorState && typeof sensorState.val === 'number') {
                let currentRaw = sensorState.val;

                // Apply offset if configured (in original unit)
                // Offset is SUBTRACTED because it represents the base meter reading
                const offsetKey = `${configType}Offset`;
                const offset = this.config[offsetKey] || 0;
                if (offset !== 0) {
                    currentRaw = currentRaw - offset;
                    this.log.debug(`Applied offset for ${type}: -${offset}, new value: ${currentRaw}`);
                }
                let yearlyConsumption = Math.max(0, currentRaw - initialReading);

                // For gas: convert m³ to kWh AFTER calculating the difference
                if (type === 'gas') {
                    const brennwert = this.config.gasBrennwert || 11.5;
                    const zZahl = this.config.gasZahl || 0.95;
                    const yearlyVolume = yearlyConsumption; // Save m³ value before conversion
                    yearlyConsumption = calculator.convertGasM3ToKWh(yearlyConsumption, brennwert, zZahl);
                    await this.setStateAsync(`${type}.consumption.yearlyVolume`, yearlyVolume, true);
                    this.log.info(
                        `Init yearly ${type}: ${yearlyConsumption.toFixed(2)} kWh = ${(currentRaw - initialReading).toFixed(2)} m³ (current: ${currentRaw.toFixed(2)} m³, initial: ${initialReading} m³)`,
                    );
                } else {
                    this.log.info(
                        `Init yearly ${type}: ${yearlyConsumption.toFixed(2)} (current: ${currentRaw.toFixed(2)}, initial: ${initialReading})`,
                    );
                }

                await this.setStateAsync(`${type}.consumption.yearly`, yearlyConsumption, true);
                await this.updateCosts(type); // Recalculate costs with yearly value
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
        let consumptionM3 = null; // For gas: track m³ value with offset applied (for yearly calculation)

        // Map English type to German config names
        const typeMapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        const configType = typeMapping[type] || type;

        // Apply offset FIRST (in original unit: m³ for gas, kWh for electricity/water)
        // Offset is SUBTRACTED because it represents the base meter reading
        const offsetKey = `${configType}Offset`;
        const offset = this.config[offsetKey] || 0;
        if (offset !== 0) {
            consumption = consumption - offset;
            this.log.debug(`Applied offset for ${type}: -${offset}, new value: ${consumption}`);
        }

        // For gas, convert m³ to kWh AFTER offset is applied!
        if (type === 'gas') {
            const brennwert = this.config.gasBrennwert || 11.5;
            const zZahl = this.config.gasZahl || 0.95;

            // Save m³ value (with offset applied) for yearly calculation
            consumptionM3 = consumption;

            // Store volume reading
            await this.setStateAsync(`${type}.info.meterReadingVolume`, consumption, true);

            // Convert to kWh
            consumption = calculator.convertGasM3ToKWh(consumption, brennwert, zZahl);
            consumption = calculator.roundToDecimals(consumption, 2);

            this.log.debug(
                `Gas conversion: ${consumptionM3.toFixed(2)} m³ → ${consumption} kWh (Brennwert: ${brennwert}, Z-Zahl: ${zZahl})`,
            );
        }

        // Update meter reading (in kWh for gas, m³ for water, kWh for electricity)
        await this.setStateAsync(`${type}.info.meterReading`, consumption, true);

        // Calculate deltas if we have a previous value
        const lastValue = this.lastSensorValues[sensorDP];
        if (lastValue !== undefined && consumption > lastValue) {
            const delta = consumption - lastValue;
            this.log.debug(`${type} delta: ${delta}`);

            // For gas: track volume (m³) in parallel to energy (kWh)
            if (type === 'gas') {
                // delta is already in kWh, convert back to m³ for volume tracking
                const brennwert = this.config.gasBrennwert || 11.5;
                const zZahl = this.config.gasZahl || 0.95;
                const deltaVolume = delta / (brennwert * zZahl);

                const dailyVolume = await this.getStateAsync(`${type}.consumption.dailyVolume`);
                const monthlyVolume = await this.getStateAsync(`${type}.consumption.monthlyVolume`);
                const yearlyVolume = await this.getStateAsync(`${type}.consumption.yearlyVolume`);

                await this.setStateAsync(
                    `${type}.consumption.dailyVolume`,
                    calculator.roundToDecimals(
                        (typeof dailyVolume?.val === 'number' ? dailyVolume.val : 0) + deltaVolume,
                        3,
                    ),
                    true,
                );
                await this.setStateAsync(
                    `${type}.consumption.monthlyVolume`,
                    calculator.roundToDecimals(
                        (typeof monthlyVolume?.val === 'number' ? monthlyVolume.val : 0) + deltaVolume,
                        3,
                    ),
                    true,
                );
                await this.setStateAsync(
                    `${type}.consumption.yearlyVolume`,
                    calculator.roundToDecimals(
                        (typeof yearlyVolume?.val === 'number' ? yearlyVolume.val : 0) + deltaVolume,
                        3,
                    ),
                    true,
                );
            }

            // Update daily consumption
            const dailyConsumption = await this.getStateAsync(`${type}.consumption.daily`);
            const newDaily = (typeof dailyConsumption?.val === 'number' ? dailyConsumption.val : 0) + delta;
            await this.setStateAsync(`${type}.consumption.daily`, calculator.roundToDecimals(newDaily, 2), true);

            // Update monthly consumption
            const monthlyConsumption = await this.getStateAsync(`${type}.consumption.monthly`);
            const newMonthly = (typeof monthlyConsumption?.val === 'number' ? monthlyConsumption.val : 0) + delta;
            await this.setStateAsync(`${type}.consumption.monthly`, calculator.roundToDecimals(newMonthly, 2), true);

            // Update yearly consumption
            // Calculate yearly consumption if initial reading is set
            // ALWAYS recalculate from current sensor to be reset-proof
            const typeMapping = {
                electricity: 'strom',
                water: 'wasser',
                gas: 'gas',
            };
            const configType = typeMapping[type] || type;
            const initialReadingKey = `${configType}InitialReading`;
            const initialReading = this.config[initialReadingKey] || 0;

            if (initialReading > 0) {
                // Calculate yearly as: (Current with offset applied) - Initial
                let yearlyAmount;

                if (type === 'gas') {
                    // For gas: use consumptionM3 (m³ with offset already applied)
                    // Calculate difference in m³, then convert to kWh
                    const yearlyM3 = Math.max(0, consumptionM3 - initialReading);
                    await this.setStateAsync(
                        `${type}.consumption.yearlyVolume`,
                        calculator.roundToDecimals(yearlyM3, 2),
                        true,
                    );

                    const brennwert = this.config.gasBrennwert || 11.5;
                    const zZahl = this.config.gasZahl || 0.95;
                    yearlyAmount = calculator.convertGasM3ToKWh(yearlyM3, brennwert, zZahl);
                    this.log.debug(`Yearly ${type}: ${yearlyAmount.toFixed(2)} kWh = ${yearlyM3.toFixed(2)} m³`);
                } else {
                    // For water/electricity: consumption already has offset applied
                    yearlyAmount = Math.max(0, consumption - initialReading);
                    this.log.debug(`Yearly ${type}: ${yearlyAmount.toFixed(2)}`);
                }

                await this.setStateAsync(
                    `${type}.consumption.yearly`,
                    calculator.roundToDecimals(yearlyAmount, 2),
                    true,
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
        // Map English type names to German config field names
        // Config uses German names (strom, wasser, gas) but code uses English (electricity, water, gas)
        const typeMapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };

        const configType = typeMapping[type] || type;

        // Get price and basic charge from config
        const priceKey = `${configType}Preis`;
        const grundgebuehrKey = `${configType}Grundgebuehr`;
        const price = this.config[priceKey] || 0;
        const basicChargeMonthly = this.config[grundgebuehrKey] || 0;

        if (price === 0) {
            this.log.debug(`No price configured for ${type} (${configType})`);
            return;
        }

        // Get current consumptions
        const dailyState = await this.getStateAsync(`${type}.consumption.daily`);
        const monthlyState = await this.getStateAsync(`${type}.consumption.monthly`);
        const yearlyState = await this.getStateAsync(`${type}.consumption.yearly`);

        const daily = typeof dailyState?.val === 'number' ? dailyState.val : 0;
        const monthly = typeof monthlyState?.val === 'number' ? monthlyState.val : 0;
        const yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;

        // Cost calculation
        const dailyCost = calculator.calculateCost(daily, price);
        const monthlyCost = calculator.calculateCost(monthly, price);
        const yearlyCost = calculator.calculateCost(yearly, price);

        // Calculate months since CONTRACT START (not year start!) for correct basic charge
        const contractStartKey = `${configType}ContractStart`;
        const contractStartDate = this.config[contractStartKey];

        let monthsSinceContract;
        if (contractStartDate) {
            // Parse German date format (DD.MM.YYYY or DD.MM.YY)
            const parseGermanDate = dateStr => {
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

                return new Date(year, month, day);
            };

            // Use contract start date if provided
            const contractStart = parseGermanDate(contractStartDate);

            if (contractStart && !isNaN(contractStart.getTime())) {
                const now = new Date();

                // Calculate months between contract start and now
                const yDiff = now.getFullYear() - contractStart.getFullYear();
                const mDiff = now.getMonth() - contractStart.getMonth();
                monthsSinceContract = Math.max(1, yDiff * 12 + mDiff + 1); // +1 to include start month

                this.log.debug(
                    `${type}: Contract start ${contractStartDate} (parsed: ${contractStart.toISOString()}), months since: ${monthsSinceContract}`,
                );
            } else {
                this.log.warn(`${type}: Invalid contract start date format: ${contractStartDate}. Expected DD.MM.YYYY`);
                monthsSinceContract = null;
            }
        } else {
            // Fallback: Use year start (backward compatibility for existing users)
            const yearStartState = await this.getStateAsync(`${type}.statistics.lastYearStart`);
            const yearStartTime = typeof yearStartState?.val === 'number' ? yearStartState.val : Date.now();
            const yearStart = new Date(yearStartTime);
            const now = new Date();
            const yDiff = now.getFullYear() - yearStart.getFullYear();
            const mDiff = now.getMonth() - yearStart.getMonth();
            monthsSinceContract = Math.max(1, yDiff * 12 + mDiff + 1);

            this.log.debug(`${type}: No contract start, using year start. Months: ${monthsSinceContract}`);
        }

        // Basic charge accumulated = monthly × months since contract start
        const basicChargeAccumulated = basicChargeMonthly * monthsSinceContract;

        // Update cost states
        await this.setStateAsync(`${type}.costs.daily`, calculator.roundToDecimals(dailyCost, 2), true);
        await this.setStateAsync(`${type}.costs.monthly`, calculator.roundToDecimals(monthlyCost, 2), true);
        await this.setStateAsync(`${type}.costs.yearly`, calculator.roundToDecimals(yearlyCost, 2), true);
        await this.setStateAsync(
            `${type}.costs.basicCharge`,
            calculator.roundToDecimals(basicChargeAccumulated, 2),
            true,
        );

        // Abschlag Calculation
        // Use monthsSinceContract (already calculated above) for correct billing period
        const abschlagKey = `${configType}Abschlag`;
        const monthlyAbschlag = this.config[abschlagKey] || 0;

        if (monthlyAbschlag > 0 && monthsSinceContract) {
            // Calculate total paid via Abschlag (monthly payment × months since contract start)
            const paidTotal = monthlyAbschlag * monthsSinceContract;

            // Calculate consumed cost (yearly consumption + accumulated basic charge)
            const consumedCostSoFar = yearlyCost + basicChargeAccumulated;

            // Balance: negative = credit (you get money back), positive = additional payment needed
            const balance = consumedCostSoFar - paidTotal;

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
        const priceKey = `${type}Preis`;
        const price = this.config[priceKey] || 0;

        await this.setStateAsync(`${type}.info.currentPrice`, calculator.roundToDecimals(price, 4), true);
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

            // Check daily reset (any time after day change)
            const lastDayStart = await this.getStateAsync(`${type}.statistics.lastDayStart`);
            if (lastDayStart?.val && typeof lastDayStart.val === 'number') {
                const lastDay = new Date(lastDayStart.val);
                // Reset if day OR month changed (handles month transitions)
                if (now.getDate() !== lastDay.getDate() || now.getMonth() !== lastDay.getMonth()) {
                    await this.resetDailyCounters(type);
                }
            }

            // Check monthly reset (1st of any month)
            const lastMonthStart = await this.getStateAsync(`${type}.statistics.lastMonthStart`);
            if (lastMonthStart?.val && typeof lastMonthStart.val === 'number') {
                const lastMonth = new Date(lastMonthStart.val);
                // Reset if month changed
                if (now.getMonth() !== lastMonth.getMonth() || now.getFullYear() !== lastMonth.getFullYear()) {
                    await this.resetMonthlyCounters(type);
                }
            }

            // Check yearly reset (CONTRACT ANNIVERSARY, not calendar year!)
            // This is critical for correct cost calculations
            const contractStartKey =
                type === 'gas' ? 'gasContractStart' : type === 'water' ? 'wasserContractStart' : 'stromContractStart';
            const contractStartDate = this.config[contractStartKey];

            const lastYearStart = await this.getStateAsync(`${type}.statistics.lastYearStart`);
            if (lastYearStart?.val && typeof lastYearStart.val === 'number') {
                const lastYearStartDate = new Date(lastYearStart.val);

                if (contractStartDate) {
                    // Use contract anniversary for reset
                    const contractStart = new Date(contractStartDate);
                    const anniversaryMonth = contractStart.getMonth();
                    const anniversaryDay = contractStart.getDate();

                    // Check if we passed the anniversary this year
                    // Only reset once per year on the anniversary date
                    const isAtOrPastAnniversary =
                        now.getMonth() > anniversaryMonth ||
                        (now.getMonth() === anniversaryMonth && now.getDate() >= anniversaryDay);

                    const lastResetWasThisYear = lastYearStartDate.getFullYear() === now.getFullYear();

                    if (isAtOrPastAnniversary && !lastResetWasThisYear) {
                        this.log.info(
                            `${type}: Contract anniversary reached (${anniversaryDay}.${anniversaryMonth + 1}). Resetting yearly counters.`,
                        );
                        await this.resetYearlyCounters(type);
                    }
                } else {
                    // Fallback: Calendar year reset (January 1st) for backward compatibility
                    if (now.getFullYear() !== lastYearStartDate.getFullYear()) {
                        this.log.info(`${type}: Year changed (no contract date set). Resetting yearly counters.`);
                        await this.resetYearlyCounters(type);
                    }
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
        if (!state || state.val === null || state.val === undefined) {
            // Ignore deleted or empty states
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
