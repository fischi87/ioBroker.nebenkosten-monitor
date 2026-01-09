/**
 * State Manager module for nebenkosten-monitor
 * Manages the creation and structure of all adapter states
 */

/**
 * State role definitions for different state types
 */
const STATE_ROLES = {
    consumption: 'value.power.consumption',
    cost: 'value.money',
    meterReading: 'value',
    price: 'value.price',
    timestamp: 'value.time',
    indicator: 'indicator',
};

/**
 * Creates the complete state structure for a utility type (gas, water, electricity)
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', or 'electricity'
 * @param {object} _config - Configuration for this utility
 * @returns {Promise<void>}
 */
async function createUtilityStateStructure(adapter, type, _config = {}) {
    const isGas = type === 'gas';

    const labels = {
        gas: { name: 'Gas', unit: 'kWh', volumeUnit: 'm³' },
        water: { name: 'Wasser', unit: 'm³', volumeUnit: 'm³' },
        electricity: { name: 'Strom', unit: 'kWh', volumeUnit: 'kWh' },
    };

    const label = labels[type];

    // Create main channel
    await adapter.setObjectNotExistsAsync(type, {
        type: 'channel',
        common: {
            name: `${label.name}-Überwachung`,
        },
        native: {},
    });

    // CONSUMPTION STATES
    await adapter.setObjectNotExistsAsync(`${type}.consumption`, {
        type: 'channel',
        common: {
            name: 'Verbrauch',
        },
        native: {},
    });

    // For gas: add volume states (m³) in addition to energy states (kWh)
    // Water doesn't need volume states because it's already measured in m³
    if (type === 'gas') {
        await adapter.setObjectNotExistsAsync(`${type}.consumption.dailyVolume`, {
            type: 'state',
            common: {
                name: 'Täglicher Verbrauch (m³)',
                type: 'number',
                role: STATE_ROLES.consumption,
                read: true,
                write: false,
                unit: 'm³',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.consumption.monthlyVolume`, {
            type: 'state',
            common: {
                name: 'Monatlicher Verbrauch (m³)',
                type: 'number',
                role: STATE_ROLES.consumption,
                read: true,
                write: false,
                unit: 'm³',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.consumption.yearlyVolume`, {
            type: 'state',
            common: {
                name: 'Jährlicher Verbrauch (m³)',
                type: 'number',
                role: STATE_ROLES.consumption,
                read: true,
                write: false,
                unit: 'm³',
                def: 0,
            },
            native: {},
        });
    }

    await adapter.setObjectNotExistsAsync(`${type}.consumption.daily`, {
        type: 'state',
        common: {
            name: `Tagesverbrauch (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.consumption.monthly`, {
        type: 'state',
        common: {
            name: `Monatsverbrauch (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.consumption.yearly`, {
        type: 'state',
        common: {
            name: `Jahresverbrauch (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    // Map internal type to config type (electricity -> strom, water -> wasser, gas -> gas)
    const configTypeMap = {
        electricity: 'strom',
        water: 'wasser',
        gas: 'gas',
    };
    const configType = configTypeMap[type] || type;

    // HT/NT consumption states - only create if HT/NT tariff is enabled
    // Note: Water typically doesn't have HT/NT, but logic remains generic if config exists
    const htNtEnabledKey = `${configType}HtNtEnabled`;
    if (_config[htNtEnabledKey]) {
        const htNtStates = ['dailyHT', 'dailyNT', 'monthlyHT', 'monthlyNT', 'yearlyHT', 'yearlyNT'];
        const htNtLabels = {
            dailyHT: 'Tagesverbrauch Haupttarif (HT)',
            dailyNT: 'Tagesverbrauch Nebentarif (NT)',
            monthlyHT: 'Monatsverbrauch Haupttarif (HT)',
            monthlyNT: 'Monatsverbrauch Nebentarif (NT)',
            yearlyHT: 'Jahresverbrauch Haupttarif (HT)',
            yearlyNT: 'Jahresverbrauch Nebentarif (NT)',
        };

        for (const state of htNtStates) {
            await adapter.setObjectNotExistsAsync(`${type}.consumption.${state}`, {
                type: 'state',
                common: {
                    name: `${htNtLabels[state]} (${label.unit})`,
                    type: 'number',
                    role: STATE_ROLES.consumption,
                    read: true,
                    write: false,
                    unit: label.unit,
                    def: 0,
                },
                native: {},
            });
        }
    }

    await adapter.setObjectNotExistsAsync(`${type}.consumption.lastUpdate`, {
        type: 'state',
        common: {
            name: 'Letzte Aktualisierung',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    // COST STATES
    await adapter.setObjectNotExistsAsync(`${type}.costs`, {
        type: 'channel',
        common: {
            name: 'Kosten',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.daily`, {
        type: 'state',
        common: {
            name: 'Tageskosten (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.monthly`, {
        type: 'state',
        common: {
            name: 'Monatskosten (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.yearly`, {
        type: 'state',
        common: {
            name: 'Jahreskosten (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    // HT/NT states - only create if HT/NT tariff is enabled
    // Note: htNtEnabledKey already calculated above for consumption section
    if (_config[htNtEnabledKey]) {
        await adapter.setObjectNotExistsAsync(`${type}.costs.yearlyHT`, {
            type: 'state',
            common: {
                name: 'Jahreskosten Haupttarif (HT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.costs.yearlyNT`, {
            type: 'state',
            common: {
                name: 'Jahreskosten Nebentarif (NT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.costs.monthlyHT`, {
            type: 'state',
            common: {
                name: 'Monatskosten Haupttarif (HT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.costs.monthlyNT`, {
            type: 'state',
            common: {
                name: 'Monatskosten Nebentarif (NT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.costs.dailyHT`, {
            type: 'state',
            common: {
                name: 'Tageskosten Haupttarif (HT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${type}.costs.dailyNT`, {
            type: 'state',
            common: {
                name: 'Tageskosten Nebentarif (NT) (€)',
                type: 'number',
                role: STATE_ROLES.cost,
                read: true,
                write: false,
                unit: '€',
                def: 0,
            },
            native: {},
        });
    }

    await adapter.setObjectNotExistsAsync(`${type}.costs.totalYearly`, {
        type: 'state',
        common: {
            name: 'Gesamtkosten Jahr (Verbrauch + Grundgebühr) (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.annualFee`, {
        type: 'state',
        common: {
            name: 'Jahresgebühr akkumuliert (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.basicCharge`, {
        type: 'state',
        common: {
            name: 'Grundgebühr (€/Monat)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.paidTotal`, {
        type: 'state',
        common: {
            name: 'Bezahlt gesamt (Abschlag × Monate)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.costs.balance`, {
        type: 'state',
        common: {
            name: 'Saldo (Bezahlt - Verbraucht)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
        },
        native: {},
    });

    // BILLING STATES (Abrechnungszeitraum-Management)
    await adapter.setObjectNotExistsAsync(`${type}.billing`, {
        type: 'channel',
        common: {
            name: 'Abrechnungszeitraum',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.endReading`, {
        type: 'state',
        common: {
            name: 'Endzählerstand (manuell eintragen)',
            type: 'number',
            role: STATE_ROLES.meterReading,
            read: true,
            write: true,
            unit: label.volumeUnit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.closePeriod`, {
        type: 'state',
        common: {
            name: 'Zeitraum jetzt abschließen (Button)',
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            def: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.periodEnd`, {
        type: 'state',
        common: {
            name: 'Abrechnungszeitraum endet am',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: '',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.daysRemaining`, {
        type: 'state',
        common: {
            name: 'Tage bis Abrechnungsende',
            type: 'number',
            role: 'value',
            read: true,
            write: false,
            unit: 'Tage',
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.newInitialReading`, {
        type: 'state',
        common: {
            name: 'Neuer Startwert (für Config übernehmen!)',
            type: 'number',
            role: STATE_ROLES.meterReading,
            read: true,
            write: false,
            unit: label.volumeUnit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.notificationSent`, {
        type: 'state',
        common: {
            name: 'Benachrichtigung Zählerstand versendet',
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.billing.notificationChangeSent`, {
        type: 'state',
        common: {
            name: 'Benachrichtigung Vertragswechsel versendet',
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });

    // ADJUSTMENT STATES (Manuelle Anpassung)
    await adapter.setObjectNotExistsAsync(`${type}.adjustment`, {
        type: 'channel',
        common: {
            name: 'Manuelle Anpassung',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.value`, {
        type: 'state',
        common: {
            name: 'Korrekturwert (Differenz zum echten Zähler)',
            type: 'number',
            role: STATE_ROLES.value,
            read: true,
            write: true,
            unit: label.volumeUnit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.note`, {
        type: 'state',
        common: {
            name: 'Notiz/Grund für Anpassung',
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: '',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.adjustment.applied`, {
        type: 'state',
        common: {
            name: 'Zeitstempel der letzten Anwendung',
            type: 'number',
            role: 'value.time',
            read: true,
            write: false,
            def: 0,
        },
        native: {},
    });

    // INFO STATES
    await adapter.setObjectNotExistsAsync(`${type}.info`, {
        type: 'channel',
        common: {
            name: 'Informationen',
        },
        native: {},
    });

    // For gas, store volume in m³ separate from energy in kWh
    if (isGas) {
        await adapter.setObjectNotExistsAsync(`${type}.info.meterReadingVolume`, {
            type: 'state',
            common: {
                name: `Zählerstand Volumen (${label.volumeUnit})`,
                type: 'number',
                role: STATE_ROLES.meterReading,
                read: true,
                write: false,
                unit: label.volumeUnit,
                def: 0,
            },
            native: {},
        });
    }

    await adapter.setObjectNotExistsAsync(`${type}.info.meterReading`, {
        type: 'state',
        common: {
            name: `Zählerstand (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.meterReading,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.currentPrice`, {
        type: 'state',
        common: {
            name: `Aktueller Preis (€/${label.unit})`,
            type: 'number',
            role: STATE_ROLES.price,
            read: true,
            write: false,
            unit: `€/${label.unit}`,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.lastSync`, {
        type: 'state',
        common: {
            name: 'Letzte Synchronisation',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.sensorActive`, {
        type: 'state',
        common: {
            name: 'Sensor aktiv',
            type: 'boolean',
            role: STATE_ROLES.indicator,
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.info.currentTariff`, {
        type: 'state',
        common: {
            name: 'Aktueller Tarif (HT/NT)',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: 'Standard',
        },
        native: {},
    });

    // STATISTICS STATES
    await adapter.setObjectNotExistsAsync(`${type}.statistics`, {
        type: 'channel',
        common: {
            name: 'Statistiken',
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.statistics.averageDaily`, {
        type: 'state',
        common: {
            name: `Durchschnitt pro Tag (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.statistics.averageMonthly`, {
        type: 'state',
        common: {
            name: `Durchschnitt pro Monat (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.statistics.lastDayStart`, {
        type: 'state',
        common: {
            name: 'Tageszähler zurückgesetzt am',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.statistics.lastMonthStart`, {
        type: 'state',
        common: {
            name: 'Monatszähler zurückgesetzt am',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync(`${type}.statistics.lastYearStart`, {
        type: 'state',
        common: {
            name: 'Jahreszähler zurückgesetzt am',
            type: 'number',
            role: STATE_ROLES.timestamp,
            read: true,
            write: false,
        },
        native: {},
    });

    adapter.log.debug(`State structure created for ${type}`);
}

/**
 * Deletes all states for a utility type
 *
 * @param {object} adapter - The adapter instance
 * @param {string} type - Utility type: 'gas', 'water', or 'electricity'
 * @returns {Promise<void>}
 */
async function deleteUtilityStateStructure(adapter, type) {
    try {
        await adapter.delObjectAsync(type, { recursive: true });
        adapter.log.debug(`State structure deleted for ${type}`);
    } catch (error) {
        adapter.log.warn(`Could not delete state structure for ${type}: ${error.message}`);
    }
}

module.exports = {
    createUtilityStateStructure,
    deleteUtilityStateStructure,
    STATE_ROLES,
};
