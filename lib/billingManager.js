'use strict';

const calculator = require('./calculator');

/**
 * BillingManager handles all cost calculations,
 * billing period management, and automatic resets.
 */
class BillingManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Updates cost calculations for a utility type
     *
     * @param {string} type - Utility type
     */
    async updateCosts(type) {
        const configType = this.adapter.consumptionManager.getConfigType(type);

        // Get price and basic charge from config
        const priceKey = `${configType}Preis`;
        const grundgebuehrKey = `${configType}Grundgebuehr`;
        const jahresgebuehrKey = `${configType}Jahresgebuehr`;
        const price = this.adapter.config[priceKey] || 0;
        const basicChargeMonthly = this.adapter.config[grundgebuehrKey] || 0;
        const annualFeePerYear = this.adapter.config[jahresgebuehrKey] || 0;

        const htNtEnabledKey = `${configType}HtNtEnabled`;
        const htNtEnabled = this.adapter.config[htNtEnabledKey] || false;

        if (price === 0 && !htNtEnabled) {
            this.adapter.log.debug(`No price configured for ${type} (${configType}) and HT/NT is disabled`);
            return;
        }

        // Get current consumptions
        const dailyState = await this.adapter.getStateAsync(`${type}.consumption.daily`);
        const monthlyState = await this.adapter.getStateAsync(`${type}.consumption.monthly`);
        const yearlyState = await this.adapter.getStateAsync(`${type}.consumption.yearly`);

        const daily = typeof dailyState?.val === 'number' ? dailyState.val : 0;
        const monthly = typeof monthlyState?.val === 'number' ? monthlyState.val : 0;
        let yearly = typeof yearlyState?.val === 'number' ? yearlyState.val : 0;

        // Apply manual adjustment
        const adjustmentState = await this.adapter.getStateAsync(`${type}.adjustment.value`);
        const adjustment = typeof adjustmentState?.val === 'number' ? adjustmentState.val : 0;
        if (adjustment !== 0) {
            if (type === 'gas') {
                const yearlyVolumeState = await this.adapter.getStateAsync(`${type}.consumption.yearlyVolume`);
                const yearlyVolume = typeof yearlyVolumeState?.val === 'number' ? yearlyVolumeState.val : 0;
                const totalM3 = yearlyVolume + adjustment;
                const brennwert = this.adapter.config.gasBrennwert || 11.5;
                const zZahl = this.adapter.config.gasZahl || 0.95;
                yearly = calculator.convertGasM3ToKWh(totalM3, brennwert, zZahl);
            } else {
                yearly += adjustment;
            }
        }

        // Consumption cost calculation
        let dailyConsumptionCost, monthlyConsumptionCost, yearlyConsumptionCost;

        if (htNtEnabled) {
            // HT/NT Calculation
            const htPrice = this.adapter.config[`${configType}HtPrice`] || 0;
            const ntPrice = this.adapter.config[`${configType}NtPrice`] || 0;

            const dailyHT = (await this.adapter.getStateAsync(`${type}.consumption.dailyHT`))?.val || 0;
            const dailyNT = (await this.adapter.getStateAsync(`${type}.consumption.dailyNT`))?.val || 0;
            const monthlyHT = (await this.adapter.getStateAsync(`${type}.consumption.monthlyHT`))?.val || 0;
            const monthlyNT = (await this.adapter.getStateAsync(`${type}.consumption.monthlyNT`))?.val || 0;

            let yearlyHT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0;
            const yearlyNT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0;

            if (adjustment !== 0) {
                if (type === 'gas') {
                    const brennwert = this.adapter.config.gasBrennwert || 11.5;
                    const zZahl = this.adapter.config.gasZahl || 0.95;
                    yearlyHT = Number(yearlyHT) + calculator.convertGasM3ToKWh(adjustment, brennwert, zZahl);
                } else {
                    yearlyHT = Number(yearlyHT) + Number(adjustment);
                }
            }

            dailyConsumptionCost = Number(dailyHT) * parseFloat(htPrice) + Number(dailyNT) * parseFloat(ntPrice);
            monthlyConsumptionCost = Number(monthlyHT) * parseFloat(htPrice) + Number(monthlyNT) * parseFloat(ntPrice);
            yearlyConsumptionCost = Number(yearlyHT) * parseFloat(htPrice) + Number(yearlyNT) * parseFloat(ntPrice);

            // Update HT/NT specific cost states
            await this.adapter.setStateAsync(
                `${type}.costs.dailyHT`,
                calculator.roundToDecimals(Number(dailyHT) * parseFloat(htPrice), 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.costs.dailyNT`,
                calculator.roundToDecimals(Number(dailyNT) * calculator.ensureNumber(ntPrice), 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.costs.monthlyHT`,
                calculator.roundToDecimals(Number(monthlyHT) * calculator.ensureNumber(htPrice), 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.costs.monthlyNT`,
                calculator.roundToDecimals(Number(monthlyNT) * calculator.ensureNumber(ntPrice), 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.costs.yearlyHT`,
                calculator.roundToDecimals(Number(yearlyHT) * calculator.ensureNumber(htPrice), 2),
                true,
            );
            await this.adapter.setStateAsync(
                `${type}.costs.yearlyNT`,
                calculator.roundToDecimals(Number(yearlyNT) * calculator.ensureNumber(ntPrice), 2),
                true,
            );
        } else {
            dailyConsumptionCost = calculator.calculateCost(daily, price);
            monthlyConsumptionCost = calculator.calculateCost(monthly, price);
            yearlyConsumptionCost = calculator.calculateCost(yearly, price);
        }

        // Basic charge calculation
        const contractStartKey = `${configType}ContractStart`;
        const contractStartDate = this.adapter.config[contractStartKey];

        let monthsSinceContract;
        if (contractStartDate) {
            const contractStart = calculator.parseGermanDate(contractStartDate);
            if (contractStart && !isNaN(contractStart.getTime())) {
                const now = new Date();
                const yDiff = now.getFullYear() - contractStart.getFullYear();
                const mDiff = now.getMonth() - contractStart.getMonth();
                monthsSinceContract = Math.max(1, yDiff * 12 + mDiff + 1);
            }
        }

        if (monthsSinceContract === undefined) {
            const yearStartState = await this.adapter.getStateAsync(`${type}.statistics.lastYearStart`);
            const yearStartTime = typeof yearStartState?.val === 'number' ? yearStartState.val : Date.now();
            const yearStart = new Date(yearStartTime);
            const now = new Date();
            const yDiff = now.getFullYear() - yearStart.getFullYear();
            const mDiff = now.getMonth() - yearStart.getMonth();
            monthsSinceContract = Math.max(1, yDiff * 12 + mDiff + 1);
        }

        const basicChargeAccumulated = basicChargeMonthly * monthsSinceContract;
        const annualFeeAccumulated = (annualFeePerYear / 12) * monthsSinceContract;
        const totalFixCostsAccumulated = basicChargeAccumulated + annualFeeAccumulated;
        const totalYearlyCost = yearlyConsumptionCost + totalFixCostsAccumulated;

        // Update states
        await this.adapter.setStateAsync(
            `${type}.costs.daily`,
            calculator.roundToDecimals(dailyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.monthly`,
            calculator.roundToDecimals(monthlyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.yearly`,
            calculator.roundToDecimals(yearlyConsumptionCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.totalYearly`,
            calculator.roundToDecimals(totalYearlyCost, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.annualFee`,
            calculator.roundToDecimals(annualFeeAccumulated, 2),
            true,
        );
        await this.adapter.setStateAsync(
            `${type}.costs.basicCharge`,
            calculator.roundToDecimals(totalFixCostsAccumulated, 2),
            true,
        );

        // Abschlag
        const abschlagKey = `${configType}Abschlag`;
        const monthlyAbschlag = this.adapter.config[abschlagKey] || 0;

        if (monthlyAbschlag > 0) {
            const paidTotal = monthlyAbschlag * monthsSinceContract;
            const balance = totalYearlyCost - paidTotal;
            await this.adapter.setStateAsync(`${type}.costs.paidTotal`, calculator.roundToDecimals(paidTotal, 2), true);
            await this.adapter.setStateAsync(`${type}.costs.balance`, calculator.roundToDecimals(balance, 2), true);
        } else {
            await this.adapter.setStateAsync(`${type}.costs.paidTotal`, 0, true);
            await this.adapter.setStateAsync(`${type}.costs.balance`, 0, true);
        }
    }

    /**
     * Closes the billing period and archives data
     *
     * @param {string} type - Utility type
     */
    async closeBillingPeriod(type) {
        this.adapter.log.info(`🔔 Schließe Abrechnungszeitraum für ${type}...`);

        const endReadingState = await this.adapter.getStateAsync(`${type}.billing.endReading`);
        const endReading = typeof endReadingState?.val === 'number' ? endReadingState.val : null;

        if (!endReading || endReading <= 0) {
            this.adapter.log.error(
                `❌ Kein gültiger Endzählerstand für ${type}. Bitte trage zuerst einen Wert in ${type}.billing.endReading ein!`,
            );
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const configType = this.adapter.consumptionManager.getConfigType(type);
        const contractStartKey = `${configType}ContractStart`;
        const contractStart = this.adapter.config[contractStartKey];

        if (!contractStart) {
            this.adapter.log.error(`❌ Kein Vertragsbeginn für ${type} konfiguriert. Kann Jahr nicht bestimmen.`);
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const startDate = calculator.parseGermanDate(contractStart);
        if (!startDate) {
            this.adapter.log.error(`❌ Ungültiges Datum-Format für Vertragsbeginn: ${contractStart}`);
            await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
            return;
        }

        const year = startDate.getFullYear();

        // Check if this is a multi-meter setup
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
        const isMultiMeter = meters.length > 1;

        // Archives - use totals for multi-meter, main meter for single meter
        let yearlyState, totalYearlyState, balanceState;

        if (isMultiMeter) {
            // Multi-meter: use totals
            yearlyState = await this.adapter.getStateAsync(`${type}.totals.consumption.yearly`);
            totalYearlyState = await this.adapter.getStateAsync(`${type}.totals.costs.totalYearly`);
            // Balance is not available in totals, use main meter's balance as representative
            balanceState = await this.adapter.getStateAsync(`${type}.costs.balance`);
            this.adapter.log.info(`Archiving multi-meter totals for ${type} (${meters.length} meters)`);
        } else {
            // Single meter: use main meter values
            yearlyState = await this.adapter.getStateAsync(`${type}.consumption.yearly`);
            totalYearlyState = await this.adapter.getStateAsync(`${type}.costs.totalYearly`);
            balanceState = await this.adapter.getStateAsync(`${type}.costs.balance`);
        }

        const yearly = yearlyState?.val || 0;
        const totalYearly = totalYearlyState?.val || 0;
        const balance = balanceState?.val || 0;

        const htNtEnabledKey = `${configType}HtNtEnabled`;
        const htNtEnabled = this.adapter.config[htNtEnabledKey] || false;

        // ... truncated history creation for brevity, assuming standard implementation ...
        // In reality, I should copy the full logic from main.js but adapt 'this' to 'this.adapter'
        // I will do that now.

        this.adapter.log.info(`📦 Archiviere Daten für ${type} Jahr ${year}...`);

        await this.adapter.setObjectNotExistsAsync(`${type}.history`, {
            type: 'channel',
            common: { name: 'Historie' },
            native: {},
        });
        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}`, {
            type: 'channel',
            common: { name: `Jahr ${year}` },
            native: {},
        });

        const consumptionUnit = type === 'gas' ? 'kWh' : type === 'water' ? 'm³' : 'kWh';

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.yearly`, {
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
        await this.adapter.setStateAsync(`${type}.history.${year}.yearly`, yearly, true);

        if (htNtEnabled) {
            const htNtStates = [
                { id: 'yearlyHT', name: 'Haupttarif (HT)' },
                { id: 'yearlyNT', name: 'Nebentarif (NT)' },
            ];
            for (const htn of htNtStates) {
                await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.${htn.id}`, {
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
            const yHT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyHT`))?.val || 0;
            const yNT = (await this.adapter.getStateAsync(`${type}.consumption.yearlyNT`))?.val || 0;
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyHT`, yHT, true);
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyNT`, yNT, true);
        }

        if (type === 'gas' || type === 'water') {
            const yearlyVolume = (await this.adapter.getStateAsync(`${type}.consumption.yearlyVolume`))?.val || 0;
            await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.yearlyVolume`, {
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
            await this.adapter.setStateAsync(`${type}.history.${year}.yearlyVolume`, yearlyVolume, true);
        }

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.totalYearly`, {
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
        await this.adapter.setStateAsync(`${type}.history.${year}.totalYearly`, totalYearly, true);

        await this.adapter.setObjectNotExistsAsync(`${type}.history.${year}.balance`, {
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
        await this.adapter.setStateAsync(`${type}.history.${year}.balance`, balance, true);

        // Reset and Info
        await this.adapter.setStateAsync(`${type}.billing.newInitialReading`, endReading, true);
        await this.adapter.setStateAsync(`${type}.consumption.yearly`, 0, true);
        if (htNtEnabled) {
            await this.adapter.setStateAsync(`${type}.consumption.yearlyHT`, 0, true);
            await this.adapter.setStateAsync(`${type}.consumption.yearlyNT`, 0, true);
        }
        if (type === 'gas') {
            await this.adapter.setStateAsync(`${type}.consumption.yearlyVolume`, 0, true);
        }
        await this.adapter.setStateAsync(`${type}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${type}.costs.totalYearly`, 0, true);
        // NOTE: basicCharge and annualFee are NOT reset - they stay from config!
        // User is responsible for updating config if tariff changes
        await this.adapter.setStateAsync(`${type}.costs.balance`, 0, true);
        await this.adapter.setStateAsync(`${type}.costs.paidTotal`, 0, true);
        await this.adapter.setStateAsync(`${type}.billing.closePeriod`, false, true);
        await this.adapter.setStateAsync(`${type}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${type}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart to the contract anniversary date (NOT Date.now()!)
        // This ensures the next automatic reset happens on the contract date,
        // even if the user closes the period early (e.g. 2 days before)
        const thisYearAnniversary = new Date(startDate);
        thisYearAnniversary.setFullYear(new Date().getFullYear());
        await this.adapter.setStateAsync(`${type}.statistics.lastYearStart`, thisYearAnniversary.getTime(), true);

        this.adapter.log.info(`✅ Abrechnungszeitraum ${year} für ${type} erfolgreich abgeschlossen!`);
        this.adapter.log.info(
            `💡 Tipp: Prüfe deine Adapter-Konfiguration! Hat sich dein Tarif, Abschlag oder die Grundgebühr geändert?`,
        );
    }

    /**
     * Closes the billing period for a specific meter (main or additional)
     *
     * @param {string} type - Utility type
     * @param {object} meter - Meter object from multiMeterManager
     */
    async closeBillingPeriodForMeter(type, meter) {
        const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
        const label = meter.displayName || meter.name;

        this.adapter.log.info(`🔔 Schließe Abrechnungszeitraum für ${basePath} (${label})...`);

        const endReadingState = await this.adapter.getStateAsync(`${basePath}.billing.endReading`);
        const endReading = typeof endReadingState?.val === 'number' ? endReadingState.val : null;

        if (!endReading || endReading <= 0) {
            this.adapter.log.error(
                `❌ Kein gültiger Endzählerstand für ${basePath}. Bitte trage zuerst einen Wert ein!`,
            );
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        // Get contract date for THIS meter
        let contractStartDate;
        if (meter.name === 'main') {
            const configType = this.adapter.consumptionManager.getConfigType(type);
            contractStartDate = this.adapter.config[`${configType}ContractStart`];
        } else {
            contractStartDate = meter.config?.vertragsbeginn;
        }

        if (!contractStartDate) {
            this.adapter.log.error(`❌ Kein Vertragsbeginn für ${basePath} konfiguriert.`);
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        const startDate = calculator.parseGermanDate(contractStartDate);
        if (!startDate) {
            this.adapter.log.error(`❌ Ungültiges Datum-Format für Vertragsbeginn: ${contractStartDate}`);
            await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
            return;
        }

        const year = startDate.getFullYear();

        // Archive data for this meter
        // TODO: Implement full history archiving for individual meters
        // For now, just reset the meter

        // Reset consumption and costs for this meter
        await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);
        if (type === 'gas') {
            await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
        }
        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.totalYearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.balance`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.costs.paidTotal`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.billing.closePeriod`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart to contract anniversary
        const thisYearAnniversary = new Date(startDate);
        thisYearAnniversary.setFullYear(new Date().getFullYear());
        await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, thisYearAnniversary.getTime(), true);

        // Update totals if multiple meters exist
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }

        this.adapter.log.info(`✅ Abrechnungszeitraum ${year} für ${basePath} erfolgreich abgeschlossen!`);
        this.adapter.log.info(
            `💡 Tipp: Prüfe deine Adapter-Konfiguration! Hat sich dein Tarif, Abschlag oder die Grundgebühr geändert?`,
        );
    }

    /**
     * Updates billing countdown
     *
     * @param {string} type - Utility type
     */
    async updateBillingCountdown(type) {
        const configType = this.adapter.consumptionManager.getConfigType(type);
        const contractStart = this.adapter.config[`${configType}ContractStart`];

        if (!contractStart) {
            return;
        }

        const startDate = calculator.parseGermanDate(contractStart);
        if (!startDate) {
            return;
        }

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

        await this.adapter.setStateAsync(`${type}.billing.daysRemaining`, daysRemaining, true);
        await this.adapter.setStateAsync(
            `${type}.billing.periodEnd`,
            displayPeriodEnd.toLocaleDateString('de-DE'),
            true,
        );
    }

    /**
     * Checks if any period resets are needed
     */
    async checkPeriodResets() {
        if (typeof this.adapter.messagingHandler?.checkNotifications === 'function') {
            await this.adapter.messagingHandler.checkNotifications();
        }

        const now = new Date();
        const types = ['gas', 'water', 'electricity', 'pv'];

        for (const type of types) {
            const configType = this.adapter.consumptionManager.getConfigType(type);
            if (!this.adapter.config[`${configType}Aktiv`]) {
                continue;
            }

            // Update current price and tariff (e.g. for switching HT/NT)
            if (this.adapter.consumptionManager) {
                await this.adapter.consumptionManager.updateCurrentPrice(type);
            }

            const nowDate = new Date(now);

            // DAILY RESET: All meters reset together at midnight
            const lastDayStart = await this.adapter.getStateAsync(`${type}.statistics.lastDayStart`);
            if (lastDayStart?.val) {
                const lastDay = new Date(lastDayStart.val);
                if (nowDate.getDate() !== lastDay.getDate()) {
                    await this.resetDailyCounters(type);
                }
            }

            // MONTHLY RESET: All meters reset together on 1st of month
            const lastMonthStart = await this.adapter.getStateAsync(`${type}.statistics.lastMonthStart`);
            if (lastMonthStart?.val) {
                const lastMonth = new Date(lastMonthStart.val);
                if (nowDate.getMonth() !== lastMonth.getMonth()) {
                    await this.resetMonthlyCounters(type);
                }
            }

            // YEARLY RESET: Each meter resets individually based on ITS contract date
            const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];
            for (const meter of meters) {
                const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
                const lastYearStartState = await this.adapter.getStateAsync(`${basePath}.statistics.lastYearStart`);

                if (lastYearStartState?.val) {
                    const lastYearStartDate = new Date(lastYearStartState.val);

                    // Get contract date for THIS specific meter
                    let contractStartDate;
                    if (meter.name === 'main') {
                        // Main meter: use adapter config
                        contractStartDate = this.adapter.config[`${configType}ContractStart`];
                    } else {
                        // Additional meter: use meter's individual config
                        contractStartDate = meter.config?.vertragsbeginn;
                    }

                    if (contractStartDate) {
                        const contractStart = calculator.parseGermanDate(contractStartDate);
                        if (contractStart) {
                            const annMonth = contractStart.getMonth();
                            const annDay = contractStart.getDate();
                            const isPast =
                                nowDate.getMonth() > annMonth ||
                                (nowDate.getMonth() === annMonth && nowDate.getDate() >= annDay);

                            if (isPast && lastYearStartDate.getFullYear() !== nowDate.getFullYear()) {
                                this.adapter.log.info(
                                    `Yearly reset for ${basePath} (contract anniversary: ${contractStartDate})`,
                                );
                                await this.resetYearlyCountersForMeter(type, meter);

                                // Update totals if multiple meters exist
                                if (meters.length > 1) {
                                    await this.adapter.multiMeterManager.updateTotalCosts(type);
                                }
                            }
                        }
                    } else if (nowDate.getFullYear() !== lastYearStartDate.getFullYear()) {
                        // No contract date: reset on January 1st
                        this.adapter.log.info(`Yearly reset for ${basePath} (calendar year)`);
                        await this.resetYearlyCountersForMeter(type, meter);

                        // Update totals if multiple meters exist
                        if (meters.length > 1) {
                            await this.adapter.multiMeterManager.updateTotalCosts(type);
                        }
                    }
                }
            }
        }
    }

    /**
     * Resets daily counters
     *
     * @param {string} type - Utility type
     */
    async resetDailyCounters(type) {
        this.adapter.log.info(`Resetting daily counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping daily reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting daily counter for ${basePath} (${label})`);

            const dailyState = await this.adapter.getStateAsync(`${basePath}.consumption.daily`);
            const dailyValue = dailyState?.val || 0;

            // Save last day consumption
            await this.adapter.setStateAsync(`${basePath}.statistics.lastDay`, dailyValue, true);

            await this.adapter.setStateAsync(`${basePath}.consumption.daily`, 0, true);

            if (type === 'gas') {
                const dailyVolume = await this.adapter.getStateAsync(`${basePath}.consumption.dailyVolume`);
                const dailyVolumeValue = dailyVolume?.val || 0;
                // Save last day volume for gas
                await this.adapter.setStateAsync(`${basePath}.statistics.lastDayVolume`, dailyVolumeValue, true);
                await this.adapter.setStateAsync(`${basePath}.consumption.dailyVolume`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.daily`, 0, true);

            // Update lastDayStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastDayStart`, Date.now(), true);

            await this.adapter.setStateAsync(
                `${basePath}.statistics.averageDaily`,
                calculator.roundToDecimals(dailyValue, 2),
                true,
            );
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets monthly counters
     *
     * @param {string} type - Utility type
     */
    async resetMonthlyCounters(type) {
        this.adapter.log.info(`Resetting monthly counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping monthly reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting monthly counter for ${basePath} (${label})`);

            const monthlyState = await this.adapter.getStateAsync(`${basePath}.consumption.monthly`);
            const monthlyValue = monthlyState?.val || 0;

            await this.adapter.setStateAsync(`${basePath}.consumption.monthly`, 0, true);

            if (type === 'gas') {
                await this.adapter.setStateAsync(`${basePath}.consumption.monthlyVolume`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.monthly`, 0, true);

            // Update lastMonthStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastMonthStart`, Date.now(), true);

            await this.adapter.setStateAsync(
                `${basePath}.statistics.averageMonthly`,
                calculator.roundToDecimals(monthlyValue, 2),
                true,
            );
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets yearly counters
     *
     * @param {string} type - Utility type
     */
    async resetYearlyCounters(type) {
        this.adapter.log.info(`Resetting yearly counters for ${type}`);

        // Get all meters for this type (main + additional meters)
        const meters = this.adapter.multiMeterManager?.getMetersForType(type) || [];

        if (meters.length === 0) {
            this.adapter.log.warn(`No meters found for ${type}, skipping yearly reset`);
            return;
        }

        // Reset each meter
        for (const meter of meters) {
            const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
            const label = meter.displayName || meter.name;

            this.adapter.log.debug(`Resetting yearly counter for ${basePath} (${label})`);

            await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);

            if (type === 'gas') {
                await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
            }

            await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
            await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
            await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

            // Update lastYearStart timestamp
            await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, Date.now(), true);
        }

        // Update totals if multiple meters exist
        if (meters.length > 1) {
            await this.adapter.multiMeterManager.updateTotalCosts(type);
        }
    }

    /**
     * Resets yearly counters for a SINGLE meter (used for individual contract anniversaries)
     *
     * @param {string} type - Utility type
     * @param {object} meter - Meter object from multiMeterManager
     */
    async resetYearlyCountersForMeter(type, meter) {
        const basePath = meter.name === 'main' ? type : `${type}.${meter.name}`;
        const label = meter.displayName || meter.name;

        this.adapter.log.debug(`Resetting yearly counter for ${basePath} (${label})`);

        await this.adapter.setStateAsync(`${basePath}.consumption.yearly`, 0, true);

        if (type === 'gas') {
            await this.adapter.setStateAsync(`${basePath}.consumption.yearlyVolume`, 0, true);
        }

        await this.adapter.setStateAsync(`${basePath}.costs.yearly`, 0, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationSent`, false, true);
        await this.adapter.setStateAsync(`${basePath}.billing.notificationChangeSent`, false, true);

        // Update lastYearStart timestamp
        await this.adapter.setStateAsync(`${basePath}.statistics.lastYearStart`, Date.now(), true);
    }
}

module.exports = BillingManager;
