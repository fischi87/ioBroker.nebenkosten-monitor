'use strict';
const expect = require('chai').expect;
const sinon = require('sinon');
const ExportManager = require('../../lib/exportManager');

describe('ExportManager', () => {
    let exportManager;
    let adapterMock;

    beforeEach(() => {
        adapterMock = {
            namespace: 'test.0',
            log: {
                info: sinon.stub(),
                error: sinon.stub(),
                debug: sinon.stub(),
                warn: sinon.stub(),
            },
            config: {
                gasAktiv: true,
                stromAktiv: true,
                wasserAktiv: true,
                pvAktiv: true,
            },
            getForeignObjectsAsync: sinon.stub(),
            getForeignStateAsync: sinon.stub(),
            getStateAsync: sinon.stub(),
            getObjectAsync: sinon.stub(),
            writeFileAsync: sinon.stub().resolves(),
            setStateAsync: sinon.stub().resolves(),
            sendTo: sinon.stub(),
        };

        exportManager = new ExportManager(adapterMock);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('handleExportMessage', () => {
        it('should parse JSON message and call collectData, then write file', async () => {
            const msg = {
                message: JSON.stringify({
                    formatCSV: true,
                    scope: 'history',
                    catStrom: true,
                }),
                from: 'system.adapter.admin.0',
                command: 'exportData',
                callback: 'cb1',
            };

            // Mock collectData
            const collectStub = sinon.stub(exportManager, 'collectData').resolves({
                electricity: { history: { 2023: { yearly: { val: 100, unit: 'kWh' } } }, current: {} },
            });

            await exportManager.handleExportMessage(msg);

            expect(collectStub.calledOnce).to.be.true;
            expect(adapterMock.writeFileAsync.called).to.be.true;
            // Verify it was called with .export suffix
            const writeArgs = adapterMock.writeFileAsync.firstCall.args;
            expect(writeArgs[0]).to.contain('.export');

            expect(adapterMock.setStateAsync.called).to.be.true; // Check persistent state update

            expect(adapterMock.sendTo.called).to.be.true;
            const sendToArgs = adapterMock.sendTo.firstCall.args;
            expect(sendToArgs[2]).to.have.property('result');
            expect(sendToArgs[2].result).to.contain('Download-Buttons'); // Check for text instruction
        });

        it('should handle object message (non-stringified)', async () => {
            const msg = {
                message: {
                    formatCSV: true,
                    formatJSON: true,
                },
                from: 'system.adapter.admin.0',
                command: 'exportData',
                callback: 'cb2',
            };
            const collectStub = sinon.stub(exportManager, 'collectData').resolves({
                gas: { history: {}, current: {} },
            });

            await exportManager.handleExportMessage(msg);

            expect(collectStub.called).to.be.true;
            expect(adapterMock.writeFileAsync.callCount).to.equal(2); // CSV and JSON

            expect(adapterMock.sendTo.called).to.be.true;
            const sendToArgs = adapterMock.sendTo.lastCall.args;
            expect(sendToArgs[2]).to.have.property('result');
            expect(sendToArgs[2].result).to.contain('CSV Export erfolgreich');
            expect(sendToArgs[2].result).to.contain('JSON Export erfolgreich');
        });
    });

    describe('collectData', () => {
        it('should collect history data correctly', async () => {
            // Mock Objects
            adapterMock.getForeignObjectsAsync.withArgs('test.0.electricity.history.*').resolves({
                'test.0.electricity.history.2023.yearly': { type: 'state', common: { unit: 'kWh' } },
                'test.0.electricity.history.2023.costs': { type: 'state', common: { unit: '€' } },
                'test.0.electricity.history.2023': { type: 'channel' }, // Should be ignored
            });
            adapterMock.getForeignObjectsAsync.resolves({}); // Default empty

            // Mock States
            adapterMock.getForeignStateAsync
                .withArgs('test.0.electricity.history.2023.yearly')
                .resolves({ val: 1234.56 });
            adapterMock.getForeignStateAsync.withArgs('test.0.electricity.history.2023.costs').resolves({ val: 500 });

            const data = await exportManager.collectData('history', { electricity: true });

            expect(data.electricity.history).to.have.property('2023');
            expect(data.electricity.history['2023']).to.have.property('yearly');
            expect(data.electricity.history['2023'].yearly.val).to.equal(1234.56);
            expect(data.electricity.history['2023'].yearly.unit).to.equal('kWh');
        });

        it('should collect current data if scope is all', async () => {
            adapterMock.getObjectAsync.withArgs('gas.consumption.yearly').resolves({ common: { unit: 'm3' } });
            adapterMock.getStateAsync.withArgs('gas.consumption.yearly').resolves({ val: 99 });

            // Should not be called for electricity if not enabled
            adapterMock.getObjectAsync.withArgs('electricity.consumption.yearly').resolves({});

            const data = await exportManager.collectData('all', { gas: true });

            expect(data.gas.current).to.have.property('consumption.yearly');
            expect(data.gas.current['consumption.yearly'].val).to.equal(99);
            expect(data.electricity).to.be.undefined;
        });
        it('should collect only current data if scope is "current"', async () => {
            adapterMock.getObjectAsync.withArgs('electricity.consumption.yearly').resolves({ common: { unit: 'kWh' } });
            adapterMock.getStateAsync.withArgs('electricity.consumption.yearly').resolves({ val: 1200 });

            const collected = await exportManager.collectData('current', {
                electricity: true,
                gas: false,
                water: false,
                pv: false,
            });

            // History gathered? Should be empty
            expect(collected.electricity.history).to.be.empty;

            // Current gathered?
            expect(collected.electricity.current).to.have.property('consumption.yearly');
            expect(collected.electricity.current['consumption.yearly'].val).to.equal(1200);
        });
    });

    describe('generateCSV', () => {
        it('should format data as CSV', () => {
            const data = {
                electricity: {
                    history: {
                        2023: { yearly: { val: 1000, unit: 'kWh' } },
                    },
                    current: {
                        now: { val: 50, unit: 'kWh' },
                    },
                },
            };

            const csv = exportManager.generateCSV(data);
            const lines = csv.split('\n');

            expect(lines[0]).to.contain('Type;Scope;Year/Period;Metric;Value;Unit');
            expect(csv).to.contain('electricity;History;2023;yearly;1000;kWh');
            expect(csv).to.contain('electricity;Current;Now;now;50;kWh');
        });
    });
});
