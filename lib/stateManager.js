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

    await adapter.setObjectNotExistsAsync(`${type}.consumption.current`, {
        type: 'state',
        common: {
            name: `Aktueller Zählerstand (${label.unit})`,
            type: 'number',
            role: STATE_ROLES.consumption,
            read: true,
            write: false,
            unit: label.unit,
            def: 0,
        },
        native: {},
    });

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

    await adapter.setObjectNotExistsAsync(`${type}.costs.total`, {
        type: 'state',
        common: {
            name: 'Gesamtkosten (€)',
            type: 'number',
            role: STATE_ROLES.cost,
            read: true,
            write: false,
            unit: '€',
            def: 0,
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
