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

        // Subscribe to billing period closure triggers
        this.subscribeStates('*.billing.closePeriod');

        // Subscribe to manual adjustment changes
        this.subscribeStates('*.adjustment.value');
        this.subscribeStates('*.adjustment.note');

        // Set up periodic tasks
        this.setupPeriodicTasks();

        this.log.info('Nebenkosten-Monitor initialized successfully');
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
        await stateManager.createUtilityStateStructure(this, type, this.config);

        const configType = this.getConfigType(type);
        const sensorDPKey = `${configType}SensorDP`;
        const sensorDP = this.config[sensorDPKey];

        if (!sensorDP) {
            this.log.warn(`${type} is active but no sensor datapoint configured!`);
            await this.setStateAsync(`${type}.info.sensorActive`, false, true);
            return;
        }

        this.log.debug(`Using sensor datapoint for ${type}: ${sensorDP}`);

        // Log configured contract start for user verification
        const contractStartKey = `${configType}ContractStart`;
        const contractStartDateStr = this.config[contractStartKey];
        if (contractStartDateStr) {
            this.log.info(`${type}: Managed with contract start: ${contractStartDateStr}`);
        }

        // Subscribe to sensor datapoint

        this.subscribeForeignStates(sensorDP);
        await this.setStateAsync(`${type}.info.sensorActive`, true, true);
        this.log.debug(`Subscribed to ${type} sensor: ${sensorDP}`);

        // Restore last sensor value from persistent state to prevent delta loss
        const lastReading = await this.getStateAsync(`${type}.info.meterReading`);
        if (lastReading && typeof lastReading.val === 'number') {
            this.lastSensorValues[sensorDP] = lastReading.val;
            this.log.debug(`${type}: Restored last sensor value: ${lastReading.val}`);
        }

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
            // Determine year start based on contract date or January 1st
            const contractStartKey = `${configType}ContractStart`;
            const contractStartDateStr = this.config[contractStartKey];

            let yearStartDate;
            if (contractStartDateStr) {
                const contractStart = calculator.parseGermanDate(contractStartDateStr);
                if (contractStart && !isNaN(contractStart.getTime())) {
                    // Calculate last anniversary
                    const nowDate = new Date(now);
                    const currentYear = nowDate.getFullYear();
                    yearStartDate = new Date(currentYear, contractStart.getMonth(), contractStart.getDate(), 12, 0, 0);

                    // If anniversary is in the future this year, take last year
                    if (yearStartDate > nowDate) {
                        yearStartDate.setFullYear(currentYear - 1);
                    }
                }
            }

            if (!yearStartDate) {
                // Fallback: January 1st of current year
                const nowDate = new Date(now);
                yearStartDate = new Date(nowDate.getFullYear(), 0, 1, 12, 0, 0);
                this.log.info(
                    `${type}: No contract start found. Setting initial year start to January 1st: ${yearStartDate.toLocaleDateString('de-DE')}`,
                );
            }

            await this.setStateAsync(`${type}.statistics.lastYearStart`, yearStartDate.getTime(), true);
        }
        // Update current price
        await this.updateCurrentPrice(type);

        // Initial cost calculation (wichtig! Sonst bleiben Kosten bei 0)
        await this.updateCosts(type);

        // Initialize yearly consumption from initial reading if set
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

        // Update billing countdown
        await this.updateBillingCountdown(type);

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

        const configType = this.getConfigType(type);

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

        // Update last value for NEXT calculation
        this.lastSensorValues[sensorDP] = consumption;

        // Skip delta calculation if this is the first value (lastValue is undefined)
        // or if the sensor value decreased (meter reset or wrong value)
        if (lastValue === undefined || consumption <= lastValue) {
            if (lastValue !== undefined && consumption < lastValue) {
                this.log.warn(
                    `${type}: Sensor value decreased (${lastValue} -> ${consumption}). Assuming meter reset or replacement.`,
                );
            }
            // First run or reset: just update objects and recalculate costs to ensure consistency
            await this.updateCosts(type);
            return;
        }

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

        // HT/NT tracking
        const htNtEnabledKey = `${configType}HtNtEnabled`;
        if (this.config[htNtEnabledKey]) {
            const isHT = calculator.isHTTime(this.config, configType);
            const suffix = isHT ? 'HT' : 'NT';

            // Update daily HT/NT
            const dailyHTNTState = await this.getStateAsync(`${type}.consumption.daily${suffix}`);
            const newDailyHTNT = (typeof dailyHTNTState?.val === 'number' ? dailyHTNTState.val : 0) + delta;
            await this.setStateAsync(
                `${type}.consumption.daily${suffix}`,
                calculator.roundToDecimals(newDailyHTNT, 2),
                true,
            );

            // Update monthly HT/NT
            const monthlyHTNTState = await this.getStateAsync(`${type}.consumption.monthly${suffix}`);
            const newMonthlyHTNT = (typeof monthlyHTNTState?.val === 'number' ? monthlyHTNTState.val : 0) + delta;
            await this.setStateAsync(
                `${type}.consumption.monthly${suffix}`,
                calculator.roundToDecimals(newMonthlyHTNT, 2),
                true,
            );

            // Update yearly HT/NT (recalculated from initial reading logic below if enabled,
            // but we also need to store the delta-based value for the period between resets)
            const yearlyHTNTState = await this.getStateAsync(`${type}.consumption.yearly${suffix}`);
            const newYearlyHTNT = (typeof yearlyHTNTState?.val === 'number' ? yearlyHTNTState.val : 0) + delta;
            await this.setStateAsync(
                `${type}.consumption.yearly${suffix}`,
                calculator.roundToDecimals(newYearlyHTNT, 2),
                true,
            );
        }

        // Update yearly consumption
        // Calculate yearly consumption if initial reading is set
        // ALWAYS recalculate from current sensor to be reset-proof
        const initialReadingKey = `${configType}InitialReading`;
        const initialReading = this.config[initialReadingKey] || 0;

        if (initialReading > 0) {
            // Calculate yearly as: (Current with offset applied) - Initial
            let yearlyAmount;

            if (type === 'gas') {
                // For gas: use consumptionM3 (m³ with offset already applied)
                // Calculate difference in m³, then convert to kWh
                const yearlyM3 = Math.max(0, (consumptionM3 || 0) - initialReading);
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

            await this.setStateAsync(`${type}.consumption.yearly`, calculator.roundToDecimals(yearlyAmount, 2), true);
        } else {
            // Fallback: Accumulate deltas
            const yearlyConsumption = await this.getStateAsync(`${type}.consumption.yearly`);
            const newYearly = (typeof yearlyConsumption?.val === 'number' ? yearlyConsumption.val : 0) + delta;
            await this.setStateAsync(`${type}.consumption.yearly`, calculator.roundToDecimals(newYearly, 2), true);
        }

        // Recalculate costs
        await this.updateCosts(type);

        // Update timestamp
        await this.setStateAsync(`${type}.consumption.lastUpdate`, now, true);
        await this.setStateAsync(`${type}.info.lastSync`, now, true);
    }

    /**
     * Updates cost calculations for a utility type
     *
     * @param {string} type - Utility type
     */

    async updateCosts(type) {
        const configType = this.getConfigType(type);

        // Get price and basic charge from config
        const priceKey = `${configType}Preis`;
        const grundgebuehrKey = `${configType}Grundgebuehr`;
        const jahresgebuehrKey = `${configType}Jahresgebuehr`;
        const price = this.config[priceKey] || 0;
        const basicChargeMonthly = this.config[grundgebuehrKey] || 0;
        const annualFeePerYear = this.config[jahresgebuehrKey] || 0;

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
        let yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;

        // Apply manual adjustment if configured
        const adjustmentState = await this.getStateAsync(`${type}.adjustment.value`);
        const adjustment = typeof adjustmentState?.val === 'number' ? adjustmentState.val : 0;
        if (adjustment !== 0) {
            this.log.debug(`Applying adjustment to ${type}: ${adjustment}`);

            // For gas: work with m³ values, convert once at the end
            if (type === 'gas') {
                const yearlyVolumeState = await this.getStateAsync(`${type}.consumption.yearlyVolume`);
                const yearlyVolume = typeof yearlyVolumeState?.val === 'number' ? yearlyVolumeState.val : 0;

                // Add adjustment in m³ (both same unit!)
                const totalM3 = yearlyVolume + adjustment;

                // Convert to kWh once
                const brennwert = this.config.gasBrennwert || 11.5;
                const zZahl = this.config.gasZahl || 0.95;
                yearly = calculator.convertGasM3ToKWh(totalM3, brennwert, zZahl);

                this.log.debug(
                    `Gas adjustment: ${yearlyVolume} m³ + ${adjustment} m³ = ${totalM3} m³ → ${yearly.toFixed(2)} kWh`,
                );
            } else {
                // Water/Electricity: adjustment is in same unit as consumption
                yearly += adjustment;
            }
        }

        // Consumption cost calculation
        let dailyConsumptionCost, monthlyConsumptionCost, yearlyConsumptionCost;

        const htNtEnabledKey = `${configType}HtNtEnabled`;
        if (this.config[htNtEnabledKey]) {
            // HT/NT Calculation
            const htPrice = this.config[`${configType}HtPrice`] || 0;
            const ntPrice = this.config[`${configType}NtPrice`] || 0;

            // Get HT/NT consumption
            const dailyHT = (await this.getStateAsync(`${type}.consumption.dailyHT`))?.val || 0;
            const dailyNT = (await this.getStateAsync(`${type}.consumption.dailyNT`))?.val || 0;
            const monthlyHT = (await this.getStateAsync(`${type}.consumption.monthlyHT`))?.val || 0;
            const monthlyNT = (await this.getStateAsync(`${type}.consumption.monthlyNT`))?.val || 0;

            let yearlyHT = (await this.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0;
            const yearlyNT = (await this.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0;

            // Add manual adjustment to HT consumption for cost calculation
            if (adjustment !== 0) {
                if (type === 'gas') {
                    const brennwert = this.config.gasBrennwert || 11.5;
                    const zZahl = this.config.gasZahl || 0.95;
                    yearlyHT = Number(yearlyHT) + calculator.convertGasM3ToKWh(adjustment, brennwert, zZahl);
                } else {
                    yearlyHT = Number(yearlyHT) + Number(adjustment);
                }
            }

            dailyConsumptionCost = Number(dailyHT) * parseFloat(htPrice) + Number(dailyNT) * parseFloat(ntPrice);
            monthlyConsumptionCost = Number(monthlyHT) * parseFloat(htPrice) + Number(monthlyNT) * parseFloat(ntPrice);
            yearlyConsumptionCost = Number(yearlyHT) * parseFloat(htPrice) + Number(yearlyNT) * parseFloat(ntPrice);

            // Update HT/NT specific cost states
            await this.setStateAsync(
                `${type}.costs.dailyHT`,
                calculator.roundToDecimals(Number(dailyHT) * parseFloat(htPrice), 2),
                true,
            );
            await this.setStateAsync(
                `${type}.costs.dailyNT`,
                calculator.roundToDecimals(Number(dailyNT) * parseFloat(ntPrice), 2),
                true,
            );
            await this.setStateAsync(
                `${type}.costs.monthlyHT`,
                calculator.roundToDecimals(Number(monthlyHT) * parseFloat(htPrice), 2),
                true,
            );
            await this.setStateAsync(
                `${type}.costs.monthlyNT`,
                calculator.roundToDecimals(Number(monthlyNT) * parseFloat(ntPrice), 2),
                true,
            );
            await this.setStateAsync(
                `${type}.costs.yearlyHT`,
                calculator.roundToDecimals(Number(yearlyHT) * parseFloat(htPrice), 2),
                true,
            );
            await this.setStateAsync(
                `${type}.costs.yearlyNT`,
                calculator.roundToDecimals(Number(yearlyNT) * parseFloat(ntPrice), 2),
                true,
            );
        } else {
            // Standard single tariff calculation
            dailyConsumptionCost = calculator.calculateCost(daily, price);
            monthlyConsumptionCost = calculator.calculateCost(monthly, price);
            yearlyConsumptionCost = calculator.calculateCost(yearly, price);
        }

        // Calculate months since CONTRACT START (not year start!) for correct basic charge
        const contractStartKey = `${configType}ContractStart`;
        const contractStartDate = this.config[contractStartKey];

        let monthsSinceContract;
        if (contractStartDate) {
            // Use contract start date if provided
            const contractStart = calculator.parseGermanDate(contractStartDate);

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

        // --- TOTAL COST CALCULATION (Consumption + Basic Charge) ---
        // Basic charge accumulated = monthly × months since contract start
        const basicChargeAccumulated = basicChargeMonthly * (monthsSinceContract || 0);

        // Annual fee accumulated = (yearly / 12) × months since contract start
        const annualFeeMonthly = annualFeePerYear / 12;
        const annualFeeAccumulated = annualFeeMonthly * (monthsSinceContract || 0);

        // Total fix costs for basicCharge state (Basic Charge + Proportional Annual Fee)
        const totalFixCostsAccumulated = basicChargeAccumulated + annualFeeAccumulated;

        // Total yearly costs = Yearly consumption + total fix costs
        const totalYearlyCost = yearlyConsumptionCost + totalFixCostsAccumulated;

        // Update cost states
        await this.setStateAsync(`${type}.costs.daily`, calculator.roundToDecimals(dailyConsumptionCost, 2), true);
        await this.setStateAsync(`${type}.costs.monthly`, calculator.roundToDecimals(monthlyConsumptionCost, 2), true);
        await this.setStateAsync(`${type}.costs.yearly`, calculator.roundToDecimals(yearlyConsumptionCost, 2), true);
        await this.setStateAsync(`${type}.costs.totalYearly`, calculator.roundToDecimals(totalYearlyCost, 2), true);
        await this.setStateAsync(`${type}.costs.annualFee`, calculator.roundToDecimals(annualFeeAccumulated, 2), true);
        await this.setStateAsync(
            `${type}.costs.basicCharge`,
            calculator.roundToDecimals(totalFixCostsAccumulated, 2),
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
            // Note: totalYearlyCost already includes basicChargeAccumulated
            const consumedCostSoFar = totalYearlyCost;

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
            `Updated costs for ${type}: daily=${dailyConsumptionCost.toFixed(2)}€, monthly=${monthlyConsumptionCost.toFixed(2)}€, yearly=${yearlyConsumptionCost.toFixed(2)}€, totalYearly=${totalYearlyCost.toFixed(2)}€`,
        );
    }

    /**
     * Updates the current price display
     *
     * @param {string} type - Utility type
     */
    async updateCurrentPrice(type) {
        // Map English type names to German config field names
        const typeMapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        const configType = typeMapping[type] || type;

        const priceKey = `${configType}Preis`;
        const price = this.config[priceKey] || 0;

        await this.setStateAsync(`${type}.info.currentPrice`, calculator.roundToDecimals(price, 4), true);
    }

    /**
     * Closes the billing period and archives data
     *
     * @param {string} type - Utility type
     */
    async closeBillingPeriod(type) {
        this.log.info(`🔔 Schließe Abrechnungszeitraum für ${type}...`);

        // 1. Endzählerstand validieren
        const endReadingState = await this.getStateAsync(`${type}.billing.endReading`);
        const endReading = typeof endReadingState?.val === 'number' ? endReadingState.val : null;

        if (!endReading || endReading <= 0) {
            this.log.error(
                `❌ Kein gültiger Endzählerstand für ${type}. Bitte trage zuerst einen Wert in ${type}.billing.endReading ein!`,
            );
            await this.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        // 2. Aktuelles Jahr bestimmen (basierend auf Vertragsbeginn)
        const configType = this.getConfigType(type);
        const contractStartKey = `${configType}ContractStart`;
        const contractStart = this.config[contractStartKey];

        if (!contractStart) {
            this.log.error(`❌ Kein Vertragsbeginn für ${type} konfiguriert. Kann Jahr nicht bestimmen.`);
            await this.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        // Parse the contract start date using centralized helper
        const startDate = calculator.parseGermanDate(contractStart);
        if (!startDate) {
            this.log.error(`❌ Ungültiges Datum-Format für Vertragsbeginn: ${contractStart}`);
            await this.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const year = startDate.getFullYear();

        // 3. Alle aktuellen Werte auslesen
        const yearlyState = await this.getStateAsync(`${type}.consumption.yearly`);
        const totalYearlyState = await this.getStateAsync(`${type}.costs.totalYearly`);
        const balanceState = await this.getStateAsync(`${type}.costs.balance`);

        const yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;
        const totalYearly = typeof totalYearlyState?.val === 'number' ? totalYearlyState.val : 0;
        const balance = typeof balanceState?.val === 'number' ? balanceState.val : 0;

        // HT/NT states
        const htNtEnabledKey = `${configType}HtNtEnabled`;
        const htNtEnabled = this.config[htNtEnabledKey] || false;
        let yearlyHT = 0,
            yearlyNT = 0,
            costsHT = 0,
            costsNT = 0;

        if (htNtEnabled) {
            yearlyHT = Number((await this.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0);
            yearlyNT = Number((await this.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0);
            costsHT = Number((await this.getStateAsync(`${type}.costs.yearlyHT`))?.val || 0);
            costsNT = Number((await this.getStateAsync(`${type}.costs.yearlyNT`))?.val || 0);
        }

        // For gas/water: also get volume
        let yearlyVolume = 0;
        if (type === 'gas' || type === 'water') {
            const yearlyVolumeState = await this.getStateAsync(`${type}.consumption.yearlyVolume`);
            yearlyVolume = typeof yearlyVolumeState?.val === 'number' ? yearlyVolumeState.val : 0;
        }

        // 4. In Historie schreiben (dynamisch States anlegen!)
        this.log.info(`📦 Archiviere Daten für ${type} Jahr ${year}...`);

        // Create history channel if it doesn't exist
        await this.setObjectNotExistsAsync(`${type}.history`, {
            type: 'channel',
            common: {
                name: 'Historie',
            },
            native: {},
        });

        // Create year channel
        await this.setObjectNotExistsAsync(`${type}.history.${year}`, {
            type: 'channel',
            common: {
                name: `Jahr ${year}`,
            },
            native: {},
        });

        // Create and set history states
        const consumptionUnit = type === 'gas' ? 'kWh' : type === 'water' ? 'm³' : 'kWh';

        await this.setObjectNotExistsAsync(`${type}.history.${year}.yearly`, {
            type: 'state',
            common: {
                name: `Jahresverbrauch ${year}`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: consumptionUnit,
            },
            native: {},
        });
        await this.setStateAsync(`${type}.history.${year}.yearly`, yearly, true);

        // HT/NT consumption history
        if (htNtEnabled) {
            const htNtStates = [
                { id: 'yearlyHT', name: 'Haupttarif (HT)' },
                { id: 'yearlyNT', name: 'Nebentarif (NT)' },
            ];
            for (const htn of htNtStates) {
                await this.setObjectNotExistsAsync(`${type}.history.${year}.${htn.id}`, {
                    type: 'state',
                    common: {
                        name: `Jahresverbrauch ${year} ${htn.name}`,
                        type: 'number',
                        role: 'value',
                        read: true,
                        write: false,
                        unit: consumptionUnit,
                    },
                    native: {},
                });
            }
            await this.setStateAsync(`${type}.history.${year}.yearlyHT`, yearlyHT, true);
            await this.setStateAsync(`${type}.history.${year}.yearlyNT`, yearlyNT, true);
        }

        if (type === 'gas' || type === 'water') {
            await this.setObjectNotExistsAsync(`${type}.history.${year}.yearlyVolume`, {
                type: 'state',
                common: {
                    name: `Jahresverbrauch ${year} (m³)`,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'm³',
                },
                native: {},
            });
            await this.setStateAsync(`${type}.history.${year}.yearlyVolume`, yearlyVolume, true);
        }

        await this.setObjectNotExistsAsync(`${type}.history.${year}.totalYearly`, {
            type: 'state',
            common: {
                name: `Gesamtkosten ${year}`,
                type: 'number',
                role: 'value.money',
                read: true,
                write: false,
                unit: '€',
            },
            native: {},
        });
        await this.setStateAsync(`${type}.history.${year}.totalYearly`, totalYearly, true);

        // HT/NT costs history
        if (htNtEnabled) {
            const htNtCostStates = [
                { id: 'costsHT', name: 'Haupttarif (HT)' },
                { id: 'costsNT', name: 'Nebentarif (NT)' },
            ];
            for (const htc of htNtCostStates) {
                await this.setObjectNotExistsAsync(`${type}.history.${year}.${htc.id}`, {
                    type: 'state',
                    common: {
                        name: `Kosten ${year} ${htc.name}`,
                        type: 'number',
                        role: 'value.money',
                        read: true,
                        write: false,
                        unit: '€',
                    },
                    native: {},
                });
            }
            await this.setStateAsync(`${type}.history.${year}.costsHT`, costsHT, true);
            await this.setStateAsync(`${type}.history.${year}.costsNT`, costsNT, true);
        }

        await this.setObjectNotExistsAsync(`${type}.history.${year}.balance`, {
            type: 'state',
            common: {
                name: `Bilanz ${year}`,
                type: 'number',
                role: 'value.money',
                read: true,
                write: false,
                unit: '€',
            },
            native: {},
        });
        await this.setStateAsync(`${type}.history.${year}.balance`, balance, true);

        // 5. Info-State für neuen initialReading setzen
        await this.setStateAsync(`${type}.billing.newInitialReading`, endReading, true);

        this.log.warn(`⚠️ WICHTIG: Bitte aktualisiere die Config!`);
        this.log.warn(`→ Gehe zu Admin → Instanzen → nebenkosten-monitor`);
        this.log.warn(`→ Setze "${configType}InitialReading" = ${endReading}`);

        // 6. Alle Zähler zurücksetzen
        this.log.info(`🔄 Setze alle Zähler für ${type} zurück...`);
        await this.setStateAsync(`${type}.consumption.yearly`, 0, true);
        if (htNtEnabled) {
            await this.setStateAsync(`${type}.consumption.yearlyHT`, 0, true);
            await this.setStateAsync(`${type}.consumption.yearlyNT`, 0, true);
        }

        if (type === 'gas' || type === 'water') {
            await this.setStateAsync(`${type}.consumption.yearlyVolume`, 0, true);
        }
        await this.setStateAsync(`${type}.costs.yearly`, 0, true);
        if (htNtEnabled) {
            await this.setStateAsync(`${type}.costs.yearlyHT`, 0, true);
            await this.setStateAsync(`${type}.costs.yearlyNT`, 0, true);
        }
        await this.setStateAsync(`${type}.costs.totalYearly`, 0, true);
        await this.setStateAsync(`${type}.costs.basicCharge`, 0, true);
        await this.setStateAsync(`${type}.costs.annualFee`, 0, true);
        await this.setStateAsync(`${type}.costs.balance`, 0, true);
        await this.setStateAsync(`${type}.costs.paidTotal`, 0, true);

        // 7. closePeriod zurücksetzen
        await this.setStateAsync(`${type}.billing.closePeriod`, false, true);

        this.log.info(`✅ Abrechnungszeitraum ${year} für ${type} erfolgreich abgeschlossen und archiviert!`);
        this.log.info(`🎉 Neuer Zeitraum hat begonnen. Viel Erfolg!`);
    }

    /**
     * Updates billing countdown (days remaining until contract anniversary)
     *
     * @param {string} type - Utility type
     */
    async updateBillingCountdown(type) {
        const typeMapping = {
            electricity: 'strom',
            water: 'wasser',
            gas: 'gas',
        };
        const configType = typeMapping[type] || type;
        const contractStartKey = `${configType}ContractStart`;
        const contractStart = this.config[contractStartKey];

        if (!contractStart) {
            return; // No contract start configured, skip
        }

        // Parse German date format
        const parseGermanDate = dateStr => {
            if (!dateStr || typeof dateStr !== 'string') {
                return null;
            }
            const parts = dateStr.trim().split('.');
            if (parts.length !== 3) {
                return null;
            }
            let day = parseInt(parts[0], 10);
            let month = parseInt(parts[1], 10) - 1;
            let year = parseInt(parts[2], 10);
            if (year < 100) {
                year += 2000;
            }
            if (isNaN(day) || isNaN(month) || isNaN(year)) {
                return null;
            }
            // Create date at noon to avoid timezone issues
            return new Date(year, month, day, 12, 0, 0);
        };

        const startDate = parseGermanDate(contractStart);
        if (!startDate) {
            this.log.warn(`Invalid contract start date format for ${type}: ${contractStart}`);
            return;
        }

        // Calculate next anniversary
        const today = new Date();
        const nextAnniversary = new Date(startDate);
        nextAnniversary.setFullYear(today.getFullYear());

        // If anniversary already passed this year, move to next year
        if (nextAnniversary < today) {
            nextAnniversary.setFullYear(today.getFullYear() + 1);
        }

        // Calculate days remaining
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysRemaining = Math.ceil((nextAnniversary.getTime() - today.getTime()) / msPerDay);

        // For display: periodEnd should be the LAST day of the current period (the day before the anniversary)
        const displayPeriodEnd = new Date(nextAnniversary);
        displayPeriodEnd.setDate(displayPeriodEnd.getDate() - 1);

        await this.setStateAsync(`${type}.billing.daysRemaining`, daysRemaining, true);
        await this.setStateAsync(`${type}.billing.periodEnd`, displayPeriodEnd.toLocaleDateString('de-DE'), true);

        this.log.debug(
            `${type}: ${daysRemaining} Tage bis Abrechnungsende (${displayPeriodEnd.toLocaleDateString('de-DE')})`,
        );
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
        await this.setStateAsync(`${type}.consumption.dailyVolume`, 0, true);
        await this.setStateAsync(`${type}.costs.daily`, 0, true);
        await this.setStateAsync(`${type}.statistics.lastDayStart`, Date.now(), true);

        // Update average
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
        await this.setStateAsync(`${type}.consumption.monthlyVolume`, 0, true);
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
        await this.setStateAsync(`${type}.consumption.yearlyVolume`, 0, true);
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
            const nowDate = new Date(now);
            const lastDayStart = await this.getStateAsync(`${type}.statistics.lastDayStart`);
            if (lastDayStart?.val && typeof lastDayStart.val === 'number') {
                const lastDay = new Date(lastDayStart.val);
                // Reset if day OR month changed (handles month transitions)
                if (nowDate.getDate() !== lastDay.getDate() || nowDate.getMonth() !== lastDay.getMonth()) {
                    await this.resetDailyCounters(type);
                }
            }

            // Check monthly reset (1st of any month)
            const lastMonthStart = await this.getStateAsync(`${type}.statistics.lastMonthStart`);
            if (lastMonthStart?.val && typeof lastMonthStart.val === 'number') {
                const lastMonth = new Date(lastMonthStart.val);
                // Reset if month changed
                if (nowDate.getMonth() !== lastMonth.getMonth() || nowDate.getFullYear() !== lastMonth.getFullYear()) {
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
                    const contractStart = calculator.parseGermanDate(contractStartDate);

                    if (contractStart && !isNaN(contractStart.getTime())) {
                        const anniversaryMonth = contractStart.getMonth();
                        const anniversaryDay = contractStart.getDate();

                        // Check if we passed the anniversary this year
                        // Only reset once per year on the anniversary date
                        const isAtOrPastAnniversary =
                            nowDate.getMonth() > anniversaryMonth ||
                            (nowDate.getMonth() === anniversaryMonth && nowDate.getDate() >= anniversaryDay);

                        const lastResetWasThisYear = lastYearStartDate.getFullYear() === nowDate.getFullYear();

                        if (isAtOrPastAnniversary && !lastResetWasThisYear) {
                            this.log.info(
                                `${type}: Contract anniversary reached (${anniversaryDay}.${anniversaryMonth + 1}). Resetting yearly counters.`,
                            );
                            await this.resetYearlyCounters(type);
                        }
                    } else {
                        this.log.warn(
                            `${type}: Invalid contract start date format: ${contractStartDate}. Expected DD.MM.YYYY`,
                        );
                    }
                } else {
                    // Fallback: Calendar year reset (January 1st) for backward compatibility
                    if (nowDate.getFullYear() !== lastYearStartDate.getFullYear()) {
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

        // Check if this is a closePeriod button press
        if (id.includes('.billing.closePeriod') && state.val === true && !state.ack) {
            // Extract type from ID: e.g., "nebenkosten-monitor.0.gas.billing.closePeriod"
            const parts = id.split('.');
            const type = parts[parts.length - 3]; // gas, water, or electricity

            this.log.info(`User triggered billing period closure for ${type}`);
            await this.closeBillingPeriod(type);
            return;
        }

        // Check if this is an adjustment value change
        if (id.includes('.adjustment.value') && !state.ack) {
            // Extract type from ID
            const parts = id.split('.');
            const type = parts[parts.length - 3]; // gas, water, or electricity

            this.log.info(`Adjustment value changed for ${type}: ${state.val}`);

            // Update timestamp
            await this.setStateAsync(`${type}.adjustment.applied`, Date.now(), true);

            // Recalculate costs with new adjustment
            await this.updateCosts(type);
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
