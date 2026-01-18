'use strict';

const calculator = require('./calculator');
const stateManager = require('./stateManager');
const { parseConfigNumber } = require('./configParser');

/**
 * MultiMeterManager handles multiple meters per utility type
 * Supports unlimited custom-named meters (e.g., "Erdgeschoss", "Werkstatt")
 */
class MultiMeterManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} consumptionManager - ConsumptionManager instance
     * @param {object} billingManager - BillingManager instance
     */
    constructor(adapter, consumptionManager, billingManager) {
        this.adapter = adapter;
        this.consumptionManager = consumptionManager;
        this.billingManager = billingManager;
        this.lastSensorValues = {};
        this.meterRegistry = {}; // Maps sensorDP → {type, meterName}
    }

    /**
     * Maps internal utility type to config/state name
     *
     * @param {string} type - gas, water, or electricity
     * @returns {string} - gas, wasser, or strom
     */
    getConfigType(type) {
        const mapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        return mapping[type] || type;
    }

    /**
     * Normalizes meter name to valid folder name
     * Rules: lowercase, alphanumeric only, max 20 chars
     *
     * @param {string} name - User-provided meter name
     * @returns {string} - Normalized name
     */
    normalizeMeterName(name) {
        if (!name || typeof name !== 'string') {
            return 'unnamed';
        }
        return (
            name
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .substring(0, 20) || 'unnamed'
        );
    }

    /**
     * Gets all configured meters for a utility type
     * Returns array with main meter + additional meters
     *
     * @param {string} type - Utility type
     * @returns {Array} - Array of {name, config} objects
     */
    getMetersForType(type) {
        const configType = this.getConfigType(type);
        const meters = [];

        // Main meter (always present if type is active)
        const mainActive = this.adapter.config[`${configType}Aktiv`];
        if (mainActive) {
            meters.push({
                name: 'main',
                config: {
                    sensorDP: this.adapter.config[`${configType}SensorDP`],
                    preis: parseConfigNumber(this.adapter.config[`${configType}Preis`], 0),
                    offset: parseConfigNumber(this.adapter.config[`${configType}Offset`], 0),
                    initialReading: parseConfigNumber(this.adapter.config[`${configType}InitialReading`], 0),
                    contractStart: this.adapter.config[`${configType}ContractStart`],
                    grundgebuehr: parseConfigNumber(this.adapter.config[`${configType}Grundgebuehr`], 0),
                    jahresgebuehr: parseConfigNumber(this.adapter.config[`${configType}Jahresgebuehr`], 0),
                    abschlag: parseConfigNumber(this.adapter.config[`${configType}Abschlag`], 0),
                    htNtEnabled: this.adapter.config[`${configType}HtNtEnabled`] || false,
                },
            });
        }

        // Additional meters from array config
        const additionalMeters = this.adapter.config[`${configType}AdditionalMeters`];
        if (Array.isArray(additionalMeters)) {
            for (const meterConfig of additionalMeters) {
                if (meterConfig && meterConfig.name && meterConfig.sensorDP) {
                    const normalizedName = this.normalizeMeterName(meterConfig.name);

                    // Debug: Log raw config for troubleshooting
                    this.adapter.log.debug(
                        `[${type}] Meter "${normalizedName}": preis=${meterConfig.preis} (${typeof meterConfig.preis}), grundgebuehr=${meterConfig.grundgebuehr} (${typeof meterConfig.grundgebuehr}), abschlag=${meterConfig.abschlag} (${typeof meterConfig.abschlag})`,
                    );

                    const parsedConfig = {
                        sensorDP: meterConfig.sensorDP,
                        preis: parseConfigNumber(meterConfig.preis, 0),
                        offset: parseConfigNumber(meterConfig.offset, 0),
                        initialReading: parseConfigNumber(meterConfig.initialReading, 0),
                        contractStart: meterConfig.contractStart,
                        grundgebuehr: parseConfigNumber(meterConfig.grundgebuehr, 0),
                        jahresgebuehr: parseConfigNumber(meterConfig.jahresgebuehr, 0),
                        abschlag: parseConfigNumber(meterConfig.abschlag, 0),
                        htNtEnabled: false, // Additional meters don't support HT/NT
                    };

                    meters.push({
                        name: normalizedName,
                        displayName: meterConfig.name,
                        config: parsedConfig,
                    });
                }
            }
        }

        return meters;
    }

    /**
     * Finds meter by sensor datapoint
     *
     * @param {string} sensorDP - Sensor datapoint ID
     * @returns {object|null} - {type, meterName} or null
     */
    findMeterBySensor(sensorDP) {
        return this.meterRegistry[sensorDP] || null;
    }

    /**
     * Initializes all meters for a utility type
     *
     * @param {string} type - Utility type
     * @returns {Promise<void>}
     */
    async initializeType(type) {
        const meters = this.getMetersForType(type);

        if (meters.length === 0) {
            this.adapter.log.debug(`No meters configured for ${type}`);
            return;
        }

        this.adapter.log.info(`Initializing ${meters.length} meter(s) for ${type}`);

        // Initialize each meter
        for (const meter of meters) {
            await this.initializeMeter(type, meter.name, meter.config, meter.displayName);
        }

        // Create totals structure if multiple meters exist
        if (meters.length > 1) {
            await stateManager.createTotalsStructure(this.adapter, type);
            await this.updateTotalCosts(type);
        }

        // Cleanup removed meters
        await this.cleanupRemovedMeters(type, meters);
    }

    /**
     * Initializes a specific meter
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name ('main' or normalized custom name)
     * @param {object} config - Meter configuration
     * @param {string} displayName - Original display name (optional)
     * @returns {Promise<void>}
     */
    async initializeMeter(type, meterName, config, displayName) {
        const basePath = meterName === 'main' ? type : `${type}.${meterName}`;
        const label = displayName || meterName;

        this.adapter.log.info(`Initializing ${type} meter: ${label}`);

        if (!config.sensorDP) {
            this.adapter.log.warn(`${type} meter "${label}" has no sensor datapoint configured!`);
            await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, false, true);
            return;
        }

        // Create state structure
        await stateManager.createMeterStructure(this.adapter, type, meterName, config);

        // Register sensor in registry
        this.meterRegistry[config.sensorDP] = { type, meterName };

        this.adapter.log.debug(`Using sensor datapoint for ${type}.${meterName}: ${config.sensorDP}`);

        // Log configured contract start
        if (config.contractStart) {
            this.adapter.log.info(`${type}.${meterName}: Contract start: ${config.contractStart}`);
        }

        // Subscribe to sensor datapoint
        this.adapter.subscribeForeignStates(config.sensorDP);
        await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, true, true);
        this.adapter.log.debug(`Subscribed to ${type}.${meterName} sensor: ${config.sensorDP}`);

        // Restore last sensor value from persistent state
        const lastReading = await this.adapter.getStateAsync(`${basePath}.info.meterReading`);
        if (lastReading && typeof lastReading.val === 'number') {
            this.lastSensorValues[config.sensorDP] = lastReading.val;
            this.adapter.log.debug(`${type}.${meterName}: Restored last sensor value: ${lastReading.val}`);
        }

        // Initialize with current sensor value
        try {
            const sensorState = await this.adapter.getForeignStateAsync(config.sensorDP);
            if (sensorState && sensorState.val !== null && typeof sensorState.val === 'number') {
                await this.handleSensorUpdate(type, meterName, config.sensorDP, sensorState.val);
            }
        } catch (error) {
            this.adapter.log.warn(`Could not read initial value from ${config.sensorDP}: ${error.message}`);
            await this.adapter.setStateAsync(`${basePath}.info.sensorActive`, false, true);
        }

        // Initialize period start timestamps
        const nowIso = calculator.formatDateString(new Date());
        const timestampRoles = ['lastDayStart', 'lastMonthStart', 'lastYearStart'];

        for (const role of timestampRoles) {
            const statePath = `${basePath}.statistics.${role}`;
            const state = await this.adapter.getStateAsync(statePath);

            if (!state || !state.val || typeof state.val === 'number') {
                if (role === 'lastYearStart' && (!state || !state.val)) {
                    const contractStart = calculator.parseGermanDate(config.contractStart);
                    let yearStartDate;

                    if (contractStart && !isNaN(contractStart.getTime())) {
                        const now = new Date();
                        yearStartDate = new Date(
                            now.getFullYear(),
                            contractStart.getMonth(),
                            contractStart.getDate(),
                            12,
                            0,
                            0,
                        );

                        if (yearStartDate > now) {
                            yearStartDate.setFullYear(now.getFullYear() - 1);
                        }
                    }

                    if (!yearStartDate) {
                        yearStartDate = new Date(new Date().getFullYear(), 0, 1, 12, 0, 0);
                    }
                    await this.adapter.setStateAsync(statePath, calculator.formatDateString(yearStartDate), true);
                } else if (typeof state?.val === 'number') {
                    await this.adapter.setStateAsync(statePath, calculator.formatDateString(new Date(state.val)), true);
                } else {
                    await this.adapter.setStateAsync(statePath, nowIso, true);
                }
            }
        }

        // Initialize yearly consumption from initial reading if set
        if (config.initialReading > 0) {
            const sensorState = await this.adapter.getForeignStateAsync(config.sensorDP);
            if (sensorState && typeof sensorState.val === 'number') {
                let currentRaw = sensorState.val;

                if (config.offset !== 0) {
                    currentRaw = currentRaw - config.offset;
                    this.adapter.log.debug(
                        `Applied offset for ${type}.${meterName}: -${config.offset}, new value: ${currentRaw}`,
                    );
                }
                let yearlyConsumption = Math.max(0, currentRaw - config.initialReading);

                // For gas: convert m³ to kWh
                if (type === 'gas') {
                    const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
                    const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                    const yearlyVolume = yearlyConsumption;
                    yearlyConsumption = calculator.convertGasM3ToKWh(yearlyConsumption, brennwert, zZahl);
                    await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, yearlyVolume, true);
                    this.adapter.log.info(
                        `Init yearly ${type}.${meterName}: ${yearlyConsumption.toFixed(2)} kWh = ${(currentRaw - config.initialReading).toFixed(2)} m³`,
                    );
                } else {
                    this.adapter.log.info(`Init yearly ${type}.${meterName}: ${yearlyConsumption.toFixed(2)}`);
                }

                await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, yearlyConsumption, true);
            }
        }

        // Update current price
        await this.updateCurrentPrice(type, meterName, config);

        // Update billing countdown
        if (config.contractStart) {
            const startDate = calculator.parseGermanDate(config.contractStart);
            if (startDate) {
                const today = new Date();
                const nextAnniversary = new Date(startDate);
                nextAnniversary.setFullYear(today.getFullYear());

                if (nextAnniversary < today) {
                    nextAnniversary.setFullYear(today.getFullYear() + 1);
                }

                const msPerDay = 1000 * 60 * 60 * 24;
                const daysRemaining = Math.ceil((nextAnniversary.getTime() - today.getTime()) / msPerDay);
                const displayPeriodEnd = new Date(nextAnniversary);
                displayPeriodEnd.setDate(displayPeriodEnd.getDate() - 1);

                this.adapter.log.debug(
                    `[${basePath}] Billing countdown: contractStart=${config.contractStart}, daysRemaining=${daysRemaining}, periodEnd=${displayPeriodEnd.toLocaleDateString('de-DE')}`,
                );

                await this.adapter.setStateAsync(`${basePath}.billing.daysRemaining`, daysRemaining, true);
                await this.adapter.setStateAsync(
                    `${basePath}.billing.periodEnd`,
                    displayPeriodEnd.toLocaleDateString('de-DE'),
                    true,
                );
            }
        }

        // Initial cost calculation
        await this.updateCosts(type, meterName, config);

        this.adapter.log.debug(`Meter initialization completed for ${type}.${meterName}`);
    }

    /**
     * Handles sensor value updates
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {string} sensorDP - Sensor datapoint ID
     * @param {number} value - New sensor value
     */
    async handleSensorUpdate(type, meterName, sensorDP, value) {
        if (typeof value !== 'number' || value < 0) {
            this.adapter.log.warn(`Invalid sensor value for ${type}.${meterName}: ${value}`);
            return;
        }

        const basePath = meterName === 'main' ? type : `${type}.${meterName}`;
        this.adapter.log.debug(`Sensor update for ${basePath}: ${value}`);

        // Get meter config
        const meters = this.getMetersForType(type);
        const meter = meters.find(m => m.name === meterName);
        if (!meter) {
            this.adapter.log.warn(`Meter ${type}.${meterName} not found in configuration`);
            return;
        }

        const config = meter.config;
        const now = Date.now();
        let consumption = value;
        let consumptionM3 = null;

        this.adapter.log.debug(`[${basePath}] Sensor update: raw=${value}, offset=${config.offset}`);

        // Apply offset FIRST
        if (config.offset !== 0) {
            consumption = consumption - config.offset;
            this.adapter.log.debug(`[${basePath}] After offset: ${consumption}`);
        }

        // For gas, convert m³ to kWh
        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
            const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
            consumptionM3 = consumption;
            await this.adapter.setStateAsync(`${basePath}.info.meterReadingVolume`, consumption, true);
            consumption = calculator.convertGasM3ToKWh(consumption, brennwert, zZahl);
            consumption = calculator.roundToDecimals(consumption, 2);
        }

        // Update meter reading
        await this.adapter.setStateAsync(`${basePath}.info.meterReading`, consumption, true);

        // Calculate deltas
        const lastValue = this.lastSensorValues[sensorDP];
        this.lastSensorValues[sensorDP] = consumption;

        if (lastValue === undefined || consumption <= lastValue) {
            if (lastValue !== undefined && consumption < lastValue) {
                this.adapter.log.warn(
                    `${type}.${meterName}: Sensor value decreased (${lastValue} -> ${consumption}). Assuming meter reset.`,
                );
            }
            await this.updateCosts(type, meterName, config);
            await this.updateTotalCosts(type);
            return;
        }

        const delta = consumption - lastValue;
        this.adapter.log.debug(`${type}.${meterName} delta: ${delta}`);

        // Track volume for gas
        if (type === 'gas') {
            const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
            const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
            const deltaVolume = delta / (brennwert * zZahl);

            const dailyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.dailyVolume`);
            const monthlyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.monthlyVolume`);
            const yearlyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.yearlyVolume`);

            await this.adapter.setStateAsync(
                `${basePath}.consumption.dailyVolume`,
                calculator.roundToDecimals((dailyVolume?.val || 0) + deltaVolume, 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${basePath}.consumption.monthlyVolume`,
                calculator.roundToDecimals((monthlyVolume?.val || 0) + deltaVolume, 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${basePath}.consumption.yearlyVolume`,
                calculator.roundToDecimals((yearlyVolume?.val || 0) + deltaVolume, 3),
                true,
            );
        }

        // Update consumption values
        const dailyState = await this.adapter.getStateAsync(`${basePath}.consumption.daily`);
        await this.adapter.setStateAsync(
            `${basePath}.consumption.daily`,
            calculator.roundToDecimals((dailyState?.val || 0) + delta, 2),
            true,
        );

        const monthlyState = await this.adapter.getStateAsync(`${basePath}.consumption.monthly`);
        await this.adapter.setStateAsync(
            `${basePath}.consumption.monthly`,
            calculator.roundToDecimals((monthlyState?.val || 0) + delta, 2),
            true,
        );

        // Yearly consumption
        if (config.initialReading > 0) {
            let yearlyAmount;
            if (type === 'gas') {
                const yearlyM3 = Math.max(0, (consumptionM3 || 0) - config.initialReading);
                await this.adapter.setStateAsync(
                    `${basePath}.consumption.yearlyVolume`,
                    calculator.roundToDecimals(yearlyM3, 2),
                    true,
                );
                const brennwert = this.adapter.config.gasBrennwert || calculator.DEFAULTS.GAS_BRENNWERT;
                const zZahl = this.adapter.config.gasZahl || calculator.DEFAULTS.GAS_Z_ZAHL;
                yearlyAmount = calculator.convertGasM3ToKWh(yearlyM3, brennwert, zZahl);
            } else {
                yearlyAmount = Math.max(0, consumption - config.initialReading);
            }
            await this.adapter.setStateAsync(
                `${basePath}.consumption.yearly`,
                calculator.roundToDecimals(yearlyAmount, 2),
                true,
            );
        } else {
            const yState = await this.adapter.getStateAsync(`${basePath}.consumption.yearly`);
            await this.adapter.setStateAsync(
                `${basePath}.consumption.yearly`,
                calculator.roundToDecimals((yState?.val || 0) + delta, 2),
                true,
            );
        }

        await this.updateCosts(type, meterName, config);
        await this.updateTotalCosts(type);

        await this.adapter.setStateAsync(`${basePath}.consumption.lastUpdate`, now, true);
        await this.adapter.setStateAsync(`${basePath}.info.lastSync`, now, true);
    }

    /**
     * Updates the current price display
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     */
    async updateCurrentPrice(type, meterName, config) {
        const basePath = meterName === 'main' ? type : `${type}.${meterName}`;
        const configType = this.getConfigType(type);

        let tariffName = 'Standard';
        let activePrice = config.preis || 0;

        // Only main meter supports HT/NT
        if (meterName === 'main' && config.htNtEnabled) {
            const isHT = calculator.isHTTime(this.adapter.config, configType);
            if (isHT) {
                activePrice = this.adapter.config[`${configType}HtPrice`] || 0;
                tariffName = 'Haupttarif (HT)';
            } else {
                activePrice = this.adapter.config[`${configType}NtPrice`] || 0;
                tariffName = 'Nebentarif (NT)';
            }
            this.adapter.log.debug(`[${basePath}] Price update: tariff=${tariffName}, price=${activePrice}`);
        }

        await this.adapter.setStateAsync(
            `${basePath}.info.currentPrice`,
            calculator.roundToDecimals(activePrice, 4),
            true,
        );
        await this.adapter.setStateAsync(`${basePath}.info.currentTariff`, tariffName, true);
    }

    /**
     * Updates costs for a specific meter
     *
     * @param {string} type - Utility type
     * @param {string} meterName - Meter name
     * @param {object} config - Meter configuration
     */
    async updateCosts(type, meterName, config) {
        const basePath = meterName === 'main' ? type : `${type}.${meterName}`;

        // Get consumption values
        const daily = (await this.adapter.getStateAsync(`${basePath}.consumption.daily`))?.val || 0;
        const monthly = (await this.adapter.getStateAsync(`${basePath}.consumption.monthly`))?.val || 0;
        const yearly = (await this.adapter.getStateAsync(`${basePath}.consumption.yearly`))?.val || 0;

        // Get price
        const price = config.preis || 0;

        this.adapter.log.debug(
            `[${basePath}] Cost update: daily=${daily}, monthly=${monthly}, yearly=${yearly}, price=${price}`,
        );

        // Calculate consumption costs
        const dailyCost = daily * price;
        const monthlyCost = monthly * price;
        const yearlyCost = yearly * price;

        await this.adapter.setStateAsync(`${basePath}.costs.daily`, calculator.roundToDecimals(dailyCost, 2), true);
        await this.adapter.setStateAsync(`${basePath}.costs.monthly`, calculator.roundToDecimals(monthlyCost, 2), true);
        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, calculator.roundToDecimals(yearlyCost, 2), true);

        await this.adapter.setStateAsync(`${basePath}.costs.basicCharge`, Number(config.grundgebuehr) || 0, true);

        // Calculate annual fee (prorated)
        const yearStartState = await this.adapter.getStateAsync(`${basePath}.statistics.lastYearStart`);
        let annualFeeAccumulated = 0;

        if (yearStartState && yearStartState.val) {
            const yearStartDate = calculator.parseDateString(yearStartState.val);
            if (yearStartDate && !isNaN(yearStartDate.getTime())) {
                const now = new Date();
                const yearStartTime = yearStartDate.getTime();
                const nowTime = now.getTime();
                const daysSinceYearStart = Math.floor((nowTime - yearStartTime) / (1000 * 60 * 60 * 24));
                const daysInYear = calculator.isLeapYear(now.getFullYear()) ? 366 : 365;
                annualFeeAccumulated = ((config.jahresgebuehr || 0) / daysInYear) * daysSinceYearStart;
            }
        }

        await this.adapter.setStateAsync(
            `${basePath}.costs.annualFee`,
            calculator.roundToDecimals(annualFeeAccumulated, 2),
            true,
        );

        // Calculate balance and total yearly costs
        if (yearStartState && yearStartState.val) {
            const yearStartDate = calculator.parseDateString(yearStartState.val);
            if (yearStartDate && !isNaN(yearStartDate.getTime())) {
                const now = new Date();
                // Calculate paid total based on started months (not just completed months)
                // If current month has started, count it as paid
                const monthsSinceYearStart = calculator.getMonthsDifference(yearStartDate, now) + 1;

                // Calculate total yearly costs with correct months
                const basicChargeAccumulated = (config.grundgebuehr || 0) * monthsSinceYearStart;
                const totalYearlyCost = yearlyCost + basicChargeAccumulated + annualFeeAccumulated;

                await this.adapter.setStateAsync(
                    `${basePath}.costs.totalYearly`,
                    calculator.roundToDecimals(totalYearlyCost, 2),
                    true,
                );

                const paidTotal = (config.abschlag || 0) * monthsSinceYearStart;
                const balance = paidTotal - totalYearlyCost;

                this.adapter.log.debug(
                    `[${basePath}] Balance calculation: abschlag=${config.abschlag}, months=${monthsSinceYearStart}, paidTotal=${paidTotal.toFixed(2)}, totalYearly=${totalYearlyCost.toFixed(2)}, balance=${balance.toFixed(2)}`,
                );

                await this.adapter.setStateAsync(
                    `${basePath}.costs.paidTotal`,
                    calculator.roundToDecimals(paidTotal, 2),
                    true,
                );
                await this.adapter.setStateAsync(
                    `${basePath}.costs.balance`,
                    calculator.roundToDecimals(balance, 2),
                    true,
                );
            } else {
                // Fallback if yearStartDate parsing fails
                const totalYearlyCost = yearlyCost + annualFeeAccumulated;
                await this.adapter.setStateAsync(
                    `${basePath}.costs.totalYearly`,
                    calculator.roundToDecimals(totalYearlyCost, 2),
                    true,
                );
            }
        } else {
            // Fallback if no yearStartState exists
            const totalYearlyCost = yearlyCost + annualFeeAccumulated;
            await this.adapter.setStateAsync(
                `${basePath}.costs.totalYearly`,
                calculator.roundToDecimals(totalYearlyCost, 2),
                true,
            );
        }
    }

    /**
     * Updates total costs (sum of all meters)
     *
     * @param {string} type - Utility type
     */
    async updateTotalCosts(type) {
        const meters = this.getMetersForType(type);

        if (meters.length <= 1) {
            // No totals needed for single meter
            return;
        }

        let totalDaily = 0;
        let totalMonthly = 0;
        let totalYearly = 0;
        let totalCostsDaily = 0;
        let totalCostsMonthly = 0;
        let totalCostsYearly = 0;

        for (const meter of meters) {
            const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;

            totalDaily += (await this.adapter.getStateAsync(`${basePath}.consumption.daily`))?.val || 0;
            totalMonthly += (await this.adapter.getStateAsync(`${basePath}.consumption.monthly`))?.val || 0;
            totalYearly += (await this.adapter.getStateAsync(`${basePath}.consumption.yearly`))?.val || 0;

            totalCostsDaily += (await this.adapter.getStateAsync(`${basePath}.costs.daily`))?.val || 0;
            totalCostsMonthly += (await this.adapter.getStateAsync(`${basePath}.costs.monthly`))?.val || 0;
            totalCostsYearly += (await this.adapter.getStateAsync(`${basePath}.costs.totalYearly`))?.val || 0;
        }

        await this.adapter.setStateAsync(
            `${type}.totals.consumption.daily`,
            calculator.roundToDecimals(totalDaily, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.consumption.monthly`,
            calculator.roundToDecimals(totalMonthly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.consumption.yearly`,
            calculator.roundToDecimals(totalYearly, 2),
            true,
        );

        await this.adapter.setStateAsync(
            `${type}.totals.costs.daily`,
            calculator.roundToDecimals(totalCostsDaily, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.costs.monthly`,
            calculator.roundToDecimals(totalCostsMonthly, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.totals.costs.totalYearly`,
            calculator.roundToDecimals(totalCostsYearly, 2),
            true,
        );
    }

    /**
     * Cleanup removed meters
     *
     * @param {string} type - Utility type
     * @param {Array} currentMeters - Currently configured meters
     */
    async cleanupRemovedMeters(type, currentMeters) {
        // Get all existing meter folders
        try {
            const obj = await this.adapter.getObjectAsync(type);
            if (!obj) {
                return;
            }

            const children = await this.adapter.getObjectListAsync({
                startkey: `${this.adapter.namespace}.${type}.`,
                endkey: `${this.adapter.namespace}.${type}.\u9999`,
            });

            const PROTECTED_CATEGORIES = [
                'consumption',
                'costs',
                'billing',
                'info',
                'statistics',
                'adjustment',
                'history',
                'totals',
            ];
            const currentMeterNames = new Set(currentMeters.map(m => m.name));
            const existingMeterFolders = new Set();

            // Find all meter folders
            for (const item of children.rows) {
                const id = item.id.replace(`${this.adapter.namespace}.`, '');
                const parts = id.split('.');
                // Only consider it a meter folder if it's the second part and not a protected category
                if (parts.length >= 2 && parts[0] === type && !PROTECTED_CATEGORIES.includes(parts[1])) {
                    existingMeterFolders.add(parts[1]);
                }
            }

            // Delete meters that no longer exist in config
            for (const folderName of existingMeterFolders) {
                if (!currentMeterNames.has(folderName)) {
                    this.adapter.log.info(`Removing deleted meter: ${type}.${folderName}`);
                    await this.adapter.delObjectAsync(`${type}.${folderName}`, { recursive: true });
                }
            }
        } catch (error) {
            this.adapter.log.warn(`Could not cleanup removed meters for ${type}: ${error.message}`);
        }
    }
}

module.exports = MultiMeterManager;
