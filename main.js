'use strict';

/*
 * ioBroker Nebenkosten-Monitor Adapter
 * Monitors gas, water, and electricity consumption with cost calculation
 */

const utils = require('@iobroker/adapter-core');
const ConsumptionManager = require('./lib/consumptionManager');
const BillingManager = require('./lib/billingManager');
const MessagingHandler = require('./lib/messagingHandler');
const ImportManager = require('./lib/importManager');
const ExportManager = require('./lib/exportManager');

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
        this.on('message', this.onMessage.bind(this));

        // Initialize Managers
        this.consumptionManager = new ConsumptionManager(this);
        this.billingManager = new BillingManager(this);
        this.messagingHandler = new MessagingHandler(this);
        this.importManager = new ImportManager(this);
        this.exportManager = new ExportManager(this);

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

        await this.initializeUtility('pv', this.config.pvAktiv);

        // Initialize General Info States
        await this.setObjectNotExistsAsync('info', {
            type: 'channel',
            common: { name: 'General Information' },
            native: {},
        });
        await this.setObjectNotExistsAsync('info.lastMonthlyReport', {
            type: 'state',
            common: {
                name: 'Last Monthly Report Sent Date',
                type: 'string', // Storing ISO date string 'YYYY-MM-DD'
                role: 'date',
                read: true,
                write: true,
                def: '',
            },
            native: {},
        });

        // Subscribe to billing period closure triggers
        this.subscribeStates('*.billing.closePeriod');

        // Subscribe to manual adjustment changes
        this.subscribeStates('*.adjustment.value');
        this.subscribeStates('*.adjustment.note');

        // Set up periodic tasks
        this.setupPeriodicTasks();

        this.log.info('Nebenkosten-Monitor initialized successfully');
    }

    // --- Delegation Methods (backward compatibility for internal calls) ---

    async initializeUtility(type, isActive) {
        return this.consumptionManager.initializeUtility(type, isActive);
    }

    async handleSensorUpdate(type, sensorDP, value) {
        return this.consumptionManager.handleSensorUpdate(type, sensorDP, value);
    }

    async updateCurrentPrice(type) {
        return this.consumptionManager.updateCurrentPrice(type);
    }

    async updateCosts(type) {
        return this.billingManager.updateCosts(type);
    }

    async closeBillingPeriod(type) {
        return this.billingManager.closeBillingPeriod(type);
    }

    async updateBillingCountdown(type) {
        return this.billingManager.updateBillingCountdown(type);
    }

    async resetDailyCounters(type) {
        return this.billingManager.resetDailyCounters(type);
    }

    async resetMonthlyCounters(type) {
        return this.billingManager.resetMonthlyCounters(type);
    }

    async resetYearlyCounters(type) {
        return this.billingManager.resetYearlyCounters(type);
    }

    async checkPeriodResets() {
        return this.billingManager.checkPeriodResets();
    }

    async checkNotifications() {
        return this.messagingHandler.checkNotifications();
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
            return;
        }

        // Check if this is a closePeriod button press
        if (id.includes('.billing.closePeriod') && state.val === true && !state.ack) {
            const parts = id.split('.');
            const type = parts[parts.length - 3];
            this.log.info(`User triggered billing period closure for ${type}`);
            await this.closeBillingPeriod(type);
            return;
        }

        // Check if this is an adjustment value change
        if (id.includes('.adjustment.value') && !state.ack) {
            const parts = id.split('.');
            const type = parts[parts.length - 3];
            this.log.info(`Adjustment value changed for ${type}: ${state.val}`);
            await this.setStateAsync(`${type}.adjustment.applied`, Date.now(), true);
            await this.updateCosts(type);
            return;
        }

        // Determine which utility this sensor belongs to
        const types = ['gas', 'water', 'electricity', 'pv'];
        for (const type of types) {
            const configType = this.consumptionManager.getConfigType(type);
            if (this.config[`${configType}Aktiv`] && this.config[`${configType}SensorDP`] === id) {
                if (typeof state.val === 'number') {
                    await this.handleSensorUpdate(type, id, state.val);
                }
                break;
            }
        }
    }

    /**
     * Is called when adapter receives message from config window.
     *
     * @param {Record<string, any>} obj - Message object from config
     */
    async onMessage(obj) {
        if (obj.command === 'importData') {
            const result = await this.importManager.handleImportMessage(obj);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } else if (obj.command === 'exportData') {
            const result = await this.exportManager.handleExportMessage(obj);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } else {
            await this.messagingHandler.handleMessage(obj);
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
