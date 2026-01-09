'use strict';

/**
 * MessagingHandler handles all incoming adapter messages
 * and outgoing notifications.
 */
class MessagingHandler {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Is called when adapter receives message from config window.
     *
     * @param {Record<string, any>} obj - Message object from config
     */
    async handleMessage(obj) {
        if (!obj || !obj.command) {
            return;
        }

        this.adapter.log.debug(`[onMessage] Received command: ${obj.command} from ${obj.from}`);

        if (obj.command === 'getInstances') {
            try {
                const instances = await this.adapter.getForeignObjectsAsync('system.adapter.*', 'instance');
                const messengerTypes = [
                    'telegram',
                    'pushover',
                    'email',
                    'whatsapp',
                    'whatsapp-cmb',
                    'signal',
                    'signal-cmb',
                    'discord',
                    'notification-manager',
                ];
                const result = [{ value: '', label: 'kein' }];

                for (const id in instances) {
                    const parts = id.split('.');
                    const adapterName = parts[parts.length - 2];
                    if (messengerTypes.includes(adapterName)) {
                        const instanceName = id.replace('system.adapter.', '');
                        result.push({ value: instanceName, label: instanceName });
                    }
                }

                this.adapter.sendTo(obj.from, obj.command, result, obj.callback);
            } catch (error) {
                this.adapter.log.error(`Error in getInstances callback: ${error.message}`);
                this.adapter.sendTo(obj.from, obj.command, [{ value: '', label: 'Fehler' }], obj.callback);
            }
        } else if (obj.command === 'testNotification') {
            this.adapter.log.info(`[testNotification] Message data: ${JSON.stringify(obj.message)}`);
            try {
                let instance = obj.message?.instance;

                // Handle cases where Admin UI doesn't resolve the placeholder ${data.notificationInstance}
                if (!instance || instance.includes('${data.') || instance === 'none' || instance === 'kein') {
                    this.adapter.log.info('[testNotification] Using instance from saved configuration as fallback');
                    instance = this.adapter.config.notificationInstance;
                }

                if (!instance || instance === 'none' || instance === 'kein') {
                    this.adapter.sendTo(
                        obj.from,
                        obj.command,
                        { error: 'Keine Instanz ausgewählt. Bitte auswählen und einmal SPEICHERN!' },
                        obj.callback,
                    );
                    return;
                }

                this.adapter.log.info(`Sending test notification via ${instance}...`);

                const testMsg =
                    '🔔 *Nebenkosten-Monitor Test*\n\nDiese Nachricht bestätigt, dass deine Benachrichtigungseinstellungen korrekt sind! 🚀';

                // We wrap sendTo in a promise to capture success/error for the popup
                const sendResult = await new Promise(resolve => {
                    const timeout = setTimeout(() => {
                        resolve({
                            error: `Timeout: ${instance} hat nicht rechtzeitig geantwortet. Ist der Adapter aktiv?`,
                        });
                    }, 10000);

                    this.adapter.sendTo(
                        instance,
                        'send',
                        {
                            text: testMsg,
                            message: testMsg,
                            parse_mode: 'Markdown',
                        },
                        res => {
                            clearTimeout(timeout);
                            this.adapter.log.info(
                                `[testNotification] Response from ${instance}: ${JSON.stringify(res)}`,
                            );

                            if (res && (res.error || res.err)) {
                                resolve({ error: `Fehler von ${instance}: ${res.error || res.err}` });
                            } else if (
                                res &&
                                (res.sent ||
                                    res.result === 'OK' ||
                                    typeof res === 'string' ||
                                    (res.response && res.response.includes('250')))
                            ) {
                                // Specific handling for email (res.response contains SMTP code) and others
                                resolve({ result: `Erfolgreich! Antwort von ${instance}: ${JSON.stringify(res)}` });
                            } else {
                                // Fallback success if response is there but format unknown
                                resolve({ result: `Test-Nachricht an ${instance} übergeben.` });
                            }
                        },
                    );
                });

                // Respond to Admin UI - this triggers the popup
                if (obj.callback) {
                    this.adapter.sendTo(obj.from, obj.command, sendResult, obj.callback);
                }
            } catch (error) {
                this.adapter.log.error(`Failed to send test notification: ${error.message}`);
                if (obj.callback) {
                    this.adapter.sendTo(
                        obj.from,
                        obj.command,
                        { error: `Interner Fehler: ${error.message}` },
                        obj.callback,
                    );
                }
            }
        } else {
            this.adapter.log.warn(`[onMessage] Unknown command: ${obj.command}`);
            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, { error: 'Unknown command' }, obj.callback);
            }
        }
    }

    /**
     * Checks if any notifications need to be sent (reminders for billing period end or contract change)
     */
    async checkNotifications() {
        if (!this.adapter.config.notificationEnabled || !this.adapter.config.notificationInstance) {
            return;
        }

        const types = ['gas', 'water', 'electricity'];
        const typesDe = { gas: 'Gas', water: 'Wasser', electricity: 'Strom' };

        for (const type of types) {
            const configType = this.adapter.consumptionManager.getConfigType(type);
            const enabledKey = `notification${configType.charAt(0).toUpperCase() + configType.slice(1)}Enabled`;

            if (!this.adapter.config[enabledKey] || !this.adapter.config[`${configType}Aktiv`]) {
                continue;
            }

            // Get current days remaining
            const daysRemainingState = await this.adapter.getStateAsync(`${type}.billing.daysRemaining`);
            const daysRemaining = typeof daysRemainingState?.val === 'number' ? daysRemainingState.val : 999;
            const periodEndState = await this.adapter.getStateAsync(`${type}.billing.periodEnd`);
            const periodEnd = periodEndState?.val || '--.--.----';

            // 1. BILLING END REMINDER (Zählerstand ablesen)
            if (this.adapter.config.notificationBillingEnabled) {
                const billingSent = await this.adapter.getStateAsync(`${type}.billing.notificationSent`);
                const billingDaysThreshold = this.adapter.config.notificationBillingDays || 7;

                if (billingSent?.val !== true && daysRemaining <= billingDaysThreshold) {
                    const message =
                        `🔔 *Nebenkosten-Monitor: Zählerstand ablesen*\n\n` +
                        `Dein Abrechnungszeitraum für *${typesDe[type]}* endet in ${daysRemaining} Tagen!\n\n` +
                        `📅 Datum: ${periodEnd}\n\n` +
                        `Bitte trage den Zählerstand rechtzeitig ein:\n` +
                        `1️⃣ Datenpunkt: ${type}.billing.endReading\n` +
                        `2️⃣ Zeitraum abschließen: ${type}.billing.closePeriod = true`;

                    await this.sendNotification(type, message, 'billing');
                }
            }

            // 2. CONTRACT CHANGE REMINDER (Tarif wechseln / Kündigungsfrist)
            if (this.adapter.config.notificationChangeEnabled) {
                const changeSent = await this.adapter.getStateAsync(`${type}.billing.notificationChangeSent`);
                const changeDaysThreshold = this.adapter.config.notificationChangeDays || 60;

                if (changeSent?.val !== true && daysRemaining <= changeDaysThreshold) {
                    const message =
                        `💡 *Nebenkosten-Monitor: Tarif-Check*\n\n` +
                        `Dein Vertrag für *${typesDe[type]}* endet am ${periodEnd}.\n\n` +
                        `⏰ Noch ${daysRemaining} Tage bis zum Ende des Zeitraums.\n\n` +
                        `Jetzt ist ein guter Zeitpunkt, um Preise zu vergleichen oder die Kündigungsfrist zu prüfen! 💸`;

                    await this.sendNotification(type, message, 'change');
                }
            }
        }
    }

    /**
     * Helper to send notification and mark as sent
     *
     * @param {string} type - gas, water, electricity
     * @param {string} message - Message text
     * @param {string} reminderType - billing or change
     */
    async sendNotification(type, message, reminderType) {
        try {
            const instance = this.adapter.config.notificationInstance;
            this.adapter.log.info(`Sending ${reminderType} reminder for ${type} via ${instance}`);

            await this.adapter.sendToAsync(instance, 'send', {
                text: message,
                message: message,
                parse_mode: 'Markdown',
            });

            // Mark as sent
            const stateKey = reminderType === 'change' ? 'notificationChangeSent' : 'notificationSent';
            await this.adapter.setStateAsync(`${type}.billing.${stateKey}`, true, true);
        } catch (error) {
            this.adapter.log.error(`Failed to send ${reminderType} notification for ${type}: ${error.message}`);
        }
    }
}

module.exports = MessagingHandler;
