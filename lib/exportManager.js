'use strict';

/**
 * ExportManager handles data export
 */
class ExportManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Handles the exportData message
     *
     * @param {object} msg - The message object
     */
    async handleExportMessage(msg) {
        try {
            const { formatCSV, formatJSON, scope, catGas, catStrom, catWasser, catPV } =
                typeof msg.message === 'string' ? JSON.parse(msg.message) : msg.message;

            const isTrue = val => val === true || val === 'true';

            // Only export enabled categories present in config
            const categories = {
                gas: isTrue(catGas) && this.adapter.config.gasAktiv,
                electricity: isTrue(catStrom) && this.adapter.config.stromAktiv,
                water: isTrue(catWasser) && this.adapter.config.wasserAktiv,
                pv: isTrue(catPV) && this.adapter.config.pvAktiv,
            };

            const doCSV = isTrue(formatCSV);
            const doJSON = isTrue(formatJSON);

            this.adapter.log.info(
                `Generating export... CSV: ${doCSV}, JSON: ${doJSON}, Scope: ${scope}, Cats: ${JSON.stringify(
                    categories,
                )}`,
            );

            const data = await this.collectData(scope, categories);
            let output = '';
            let fileUrl = '';
            const instance = this.adapter.instance || 0;
            const targetDir = `nebenkosten-monitor.${instance}.export`;

            if (doCSV) {
                const csv = this.generateCSV(data);
                const filename = 'export.csv';
                await this.adapter.writeFileAsync(targetDir, filename, csv);

                if (output) {
                    output += '\n';
                }
                output += 'CSV Export erfolgreich.';
                fileUrl = `/files/${targetDir}/${filename}`;
            }

            if (doJSON) {
                const json = JSON.stringify(data, null, 2);
                const filename = 'export.json';
                await this.adapter.writeFileAsync(targetDir, filename, json);

                if (output) {
                    output += '\n';
                }
                output += 'JSON Export erfolgreich.';
                // If only JSON was requested (or it overwrites CSV url for auto-open), set it.
                // If both, we might prefer CSV for openUrl or just last one.
                if (!doCSV) {
                    fileUrl = `/files/${targetDir}/${filename}`;
                }
            }

            if (output) {
                await this.adapter.setStateAsync('info.lastExport', { val: new Date().toISOString(), ack: true });

                output += '\n\nFalls der Download nicht automatisch startet, klicken Sie bitte hier:\n';
                output += `[Download Datei](${fileUrl})`;

                // Send response
                const response = { result: output };

                // Only trigger auto-download if exactly one format is selected (to avoid popup blocking or confusion)
                if ((doCSV && !doJSON) || (!doCSV && doJSON)) {
                    response.native = { openUrl: fileUrl };
                    response.fileUrl = fileUrl; // Backward compat
                }

                this.adapter.sendTo(msg.from, msg.command, response, msg.callback);
            } else {
                this.adapter.sendTo(msg.from, msg.command, { result: 'Kein Format gewählt.' }, msg.callback);
            }
        } catch (error) {
            this.adapter.log.error(`Export failed: ${error.message}`);
            this.adapter.sendTo(
                msg.from,
                msg.command,
                { error: `Export fehlgeschlagen: ${error.message}` },
                msg.callback,
            );
        }
    }

    /**
     * Collects data from adapter states
     *
     * @param {string} scope - Export scope
     * @param {object} categories - Selected categories
     */
    async collectData(scope, categories) {
        const types = ['electricity', 'gas', 'water', 'pv'];
        const collected = {};

        for (const type of types) {
            if (!categories[type]) {
                continue;
            }

            collected[type] = {
                history: {},
                current: {},
            };

            // History (only if scope is NOT 'current')
            if (scope !== 'current') {
                const historyChannel = `${type}.history`;
                // Use a broad pattern to get all objects under the history channel
                const pattern = `${this.adapter.namespace}.${historyChannel}.*`;
                try {
                    const historyObjs = await this.adapter.getForeignObjectsAsync(pattern, 'state');

                    for (const id in historyObjs) {
                        const relativeId = id.replace(`${this.adapter.namespace}.`, '');
                        const relParts = relativeId.split('.');
                        // Structure: type.history.YEAR.stateName
                        // e.g. gas.history.2023.yearly
                        if (relParts.length < 4) {
                            continue;
                        }

                        const year = relParts[2];
                        const stateName = relParts.slice(3).join('.');

                        if (!collected[type].history[year]) {
                            collected[type].history[year] = {};
                        }

                        try {
                            const stateVal = await this.adapter.getForeignStateAsync(id);
                            if (stateVal) {
                                collected[type].history[year][stateName] = {
                                    val: stateVal.val,
                                    unit: historyObjs[id].common.unit,
                                };
                            }
                        } catch (err) {
                            this.adapter.log.warn(`Could not read state ${id}: ${err.message}`);
                        }
                    }
                } catch (err) {
                    this.adapter.log.warn(`Error collecting history for ${type}: ${err.message}`);
                }
            }

            // Current (if scope is 'all' or 'current')
            if (scope === 'all' || scope === 'current') {
                const currentStates = [
                    'consumption.yearly',
                    'costs.totalYearly',
                    'consumption.monthly',
                    'costs.monthly',
                    'costs.balance',
                ];

                for (const stateId of currentStates) {
                    const fullId = `${type}.${stateId}`;
                    try {
                        const obj = await this.adapter.getObjectAsync(fullId);
                        if (obj) {
                            const val = await this.adapter.getStateAsync(fullId);
                            if (val) {
                                collected[type].current[stateId] = {
                                    val: val.val,
                                    unit: obj.common.unit,
                                };
                            }
                        }
                    } catch {
                        // ignore errors for missing current states
                    }
                }
            }
        }
        return collected;
    }

    /**
     * Generates CSV string from collected data
     *
     * @param {object} data - Collected data
     * @returns {string} CSV string
     */
    generateCSV(data) {
        let csv = 'Type;Scope;Year/Period;Metric;Value;Unit\n';

        for (const type in data) {
            // History
            if (data[type].history) {
                for (const year in data[type].history) {
                    for (const metric in data[type].history[year]) {
                        const item = data[type].history[year][metric];
                        if (item && item.val !== undefined && item.val !== null) {
                            csv += `${type};History;${year};${metric};${item.val};${item.unit || ''}\n`;
                        }
                    }
                }
            }

            // Current
            if (data[type].current) {
                for (const metric in data[type].current) {
                    const item = data[type].current[metric];
                    if (item && item.val !== undefined && item.val !== null) {
                        csv += `${type};Current;Now;${metric};${item.val};${item.unit || ''}\n`;
                    }
                }
            }
        }
        return csv;
    }
}

module.exports = ExportManager;
