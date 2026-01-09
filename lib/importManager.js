'use strict';

const EhbImporter = require('./importers/ehb');

/**
 * ImportManager handles data import from different sources
 */
class ImportManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.importers = {
            ehb: new EhbImporter(adapter),
        };
    }

    /**
     * handle import message
     *
     * @param {object} msg - The message object
     */
    async handleImportMessage(msg) {
        try {
            let { utility, type, content, customName, unit } = msg.message; // utility='gas', type='ehb', content='...'

            if (utility === 'custom') {
                if (!customName) {
                    throw new Error('Name für benutzerdefinierten Zähler fehlt.');
                }
                // Sanitize name: "Garten Haus" -> "garten_haus"
                utility = customName
                    .toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_]/g, '');

                if (utility.length === 0) {
                    throw new Error('Ungültiger Name für Zähler.');
                }

                // Ensure unit is valid (default to kWh if something weird comes in)
                if (unit === 'm3') {
                    unit = 'm³'; // Fix mapping from UI value
                }
                if (!unit) {
                    unit = 'kWh';
                }
            }

            if (!this.importers[type]) {
                throw new Error(`Unknown importer type: ${type}`);
            }

            this.adapter.log.info(`[Import] Starting import for ${utility} using ${type}...`);
            const records = await this.importers[type].parse(content);

            if (!records || records.length === 0) {
                return { error: 'No valid data found in CSV.' };
            }

            const result = await this.processRecords(utility, records, unit);

            const details = result.details.map(d => `${d.year}: ${d.consumption.toFixed(2)} ${d.unit}`).join(', ');
            this.adapter.log.info(`[Import] Details: ${details}`);

            return {
                result: `Erfolgreich importiert: ${records.length} Datensätze verarbeitet.`,
                native: {
                    importContent: '',
                },
            };
        } catch (error) {
            this.adapter.log.error(`[Import] Error: ${error.message}`);
            return { error: error.message };
        }
    }

    /**
     * Process records and write to history
     *
     * @param {string} utility - The utility type (gas, water, electricity, pv, or custom name)
     * @param {Array<{timestamp: number, value: number, dateObj: Date}>} records - Parsed records
     * @param {string} [customUnit] - Unit for custom meters
     */
    async processRecords(utility, records, customUnit) {
        // Group by year
        const years = {};

        for (const r of records) {
            const year = r.dateObj.getFullYear();
            if (!years[year]) {
                years[year] = [];
            }
            years[year].push(r);
        }

        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {{ yearsUpdated: string[], details: Array<{year: number, consumption: number, unit: string}> }} */
        const stats = { yearsUpdated: [], details: [] };

        for (const year of Object.keys(years)) {
            const readings = years[year];
            // Sort just in case
            readings.sort((a, b) => a.timestamp - b.timestamp);

            const startVal = readings[0].value;
            const endVal = readings[readings.length - 1].value;
            let consumption = endVal - startVal;

            if (consumption < 0) {
                consumption = 0; // Reset handling? simpler for now.
            }

            let unit = customUnit || 'kWh'; // Default or custom

            // Gas: Convert m3 to kWh? (Only for standard 'gas' utility)
            if (utility === 'gas') {
                unit = 'kWh'; // Gas is always kWh in history despite input

                // Read current conversion factors (Not perfect for history, but better than nothing)
                const brennwert = this.adapter.config.gasBrennwert || 1;
                const zustandszahl = this.adapter.config.gasZahl || 1;

                // Save Volume
                await this.adapter.setObjectNotExistsAsync(`${utility}.history.${year}.yearlyVolume`, {
                    type: 'state',
                    common: { name: `Verbrauch ${year} in m³`, type: 'number', unit: 'm³', role: 'value' },
                    native: {},
                });
                await this.adapter.setStateAsync(`${utility}.history.${year}.yearlyVolume`, consumption, true);

                // Convert to kWh
                consumption = consumption * brennwert * zustandszahl;
            } else if (utility === 'water') {
                unit = 'm³';
            }

            // Write Yearly Consumption
            await this.adapter.setObjectNotExistsAsync(`${utility}.history.${year}`, {
                type: 'channel',
                common: { name: `Jahr ${year}` },
                native: {},
            });
            await this.adapter.setObjectNotExistsAsync(`${utility}.history.${year}.yearly`, {
                type: 'state',
                common: { name: `Jahresverbrauch ${year}`, type: 'number', unit: unit, role: 'value' },
                native: {},
            });

            const stateId = `${utility}.history.${year}.yearly`;
            await this.adapter.setStateAsync(stateId, consumption, true);

            stats.yearsUpdated.push(year);
            stats.details.push({ year: parseInt(year), consumption, unit });

            this.adapter.log.info(
                `[Import] ${utility} ${year}: ${consumption.toFixed(2)} ${unit} (from ${startVal} to ${endVal})`,
            );
        }

        return stats;
    }
}

module.exports = ImportManager;
