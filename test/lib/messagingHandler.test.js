'use strict';
const expect = require('chai').expect;
const sinon = require('sinon');
const MessagingHandler = require('../../lib/messagingHandler');

describe('MessagingHandler', () => {
    let messagingHandler;
    let adapterMock;

    beforeEach(() => {
        adapterMock = {
            config: {
                notificationEnabled: true,
                notificationInstance: 'telegram.0',
                notificationMonthlyEnabled: true,
                notificationMonthlyDay: new Date().getDate(), // Set to today
                gasAktiv: true,
                wasserAktiv: true,
                stromAktiv: true,
                pvAktiv: true,
                gasAbschlag: 10,
                stromAbschlag: 20,
            },
            consumptionManager: {
                getConfigType: sinon.stub().callsFake(type => {
                    const map = { electricity: 'strom', water: 'wasser', gas: 'gas', pv: 'pv' };
                    return map[type] || type;
                }),
            },
            log: {
                info: sinon.stub(),
                error: sinon.stub(),
                debug: sinon.stub(),
            },
            getStateAsync: sinon.stub(),
            setStateAsync: sinon.stub(),
            sendToAsync: sinon.stub(),
        };

        messagingHandler = new MessagingHandler(adapterMock);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('checkMonthlyReport', () => {
        it('should send a report if enabled and today is the configured day', async () => {
            // Mock states
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: '2020-01-01' }); // Old date

            // Electricity
            adapterMock.getStateAsync.withArgs('electricity.consumption.yearly').resolves({ val: 1000 });
            adapterMock.getStateAsync.withArgs('electricity.costs.totalYearly').resolves({ val: 300 });
            adapterMock.getStateAsync.withArgs('electricity.costs.paidTotal').resolves({ val: 240 }); // 20 * 12
            adapterMock.getStateAsync.withArgs('electricity.costs.balance').resolves({ val: 60 });

            // Gas
            adapterMock.getStateAsync.withArgs('gas.consumption.yearly').resolves({ val: 5000 });
            adapterMock.getStateAsync.withArgs('gas.costs.totalYearly').resolves({ val: 500 });
            adapterMock.getStateAsync.withArgs('gas.costs.paidTotal').resolves({ val: 600 });
            adapterMock.getStateAsync.withArgs('gas.costs.balance').resolves({ val: -100 });

            // Allow any for others
            adapterMock.getStateAsync.resolves({ val: 0 });

            await messagingHandler.checkMonthlyReport();

            expect(adapterMock.sendToAsync.calledOnce).to.be.true;
            const callArgs = adapterMock.sendToAsync.firstCall.args;
            expect(callArgs[0]).to.equal('telegram.0');
            expect(callArgs[1]).to.equal('send');

            const message = callArgs[2].text;
            expect(message).to.contain('*⚡ Strom*');
            expect(message).to.contain('Verbrauch (Jahr): 1000 kWh');
            expect(message).to.contain('Verbrauchs-Kosten: 300.00 €');
            expect(message).to.contain('❌ Nachzahlung');

            expect(message).to.contain('*🔥 Gas*');
            expect(message).to.contain('Verbrauch (Jahr): 5000 kWh');
            expect(message).to.contain('✅ Guthaben');

            const todayStr = new Date().toISOString().split('T')[0];
            expect(adapterMock.setStateAsync.calledWith('info.lastMonthlyReport', todayStr, true)).to.be.true;
        });

        it('should NOT send a report if disabled', async () => {
            adapterMock.config.notificationMonthlyEnabled = false;
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });

        it('should NOT send a report if not the configured day', async () => {
            const today = new Date().getDate();
            adapterMock.config.notificationMonthlyDay = today === 1 ? 2 : 1; // Set to different day
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });

        it('should NOT send a report if already sent today', async () => {
            const todayStr = new Date().toISOString().split('T')[0];
            adapterMock.getStateAsync.withArgs('info.lastMonthlyReport').resolves({ val: todayStr });
            await messagingHandler.checkMonthlyReport();
            expect(adapterMock.sendToAsync.called).to.be.false;
        });
    });
});
