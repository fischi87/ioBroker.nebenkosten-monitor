const expect = require('chai').expect;
const EhbImporter = require('../../lib/importers/ehb');
const ImportManager = require('../../lib/importManager');

// Mock Adapter
const adapterMock = {
    log: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
    },
    config: {
        gasBrennwert: 10,
        gasZahl: 1,
    },
    setObjectNotExistsAsync: async () => {},
    setStateAsync: async () => {},
};

describe('EhbImporter', function () {
    const importer = new EhbImporter(adapterMock);

    it('should parse valid CSV content correctly', async function () {
        const csv = `Datum;Zählerstand;Kommentar
01.01.2023 00:00;1000,0;Start
01.02.2023;1100,0;Feb`;

        const results = await importer.parse(csv);
        expect(results).to.have.lengthOf(2);
        expect(results[0].value).to.equal(1000);
        expect(results[1].value).to.equal(1100);
        expect(results[0].dateObj.getFullYear()).to.equal(2023);
    });

    it('should handle different date formats', async function () {
        const csv = `Datum;Zählerstand
01.01.2023;100
31.12.2023 23:59;200`;
        const results = await importer.parse(csv);
        expect(results).to.have.lengthOf(2);
        expect(results[0].dateObj.getHours()).to.equal(0);
        expect(results[1].dateObj.getHours()).to.equal(23);
    });
});

describe('ImportManager', function () {
    const manager = new ImportManager(adapterMock);

    it('should process simple electricity records', async function () {
        const records = [
            { timestamp: 1672531200000, value: 1000, dateObj: new Date('2023-01-01T00:00:00') },
            { timestamp: 1704063600000, value: 2000, dateObj: new Date('2023-12-31T23:00:00') },
        ];

        const stats = await manager.processRecords('electricity', records);
        expect(stats.yearsUpdated).to.include('2023');
        expect(stats.details[0].consumption).to.equal(1000);
        expect(stats.details[0].unit).to.equal('kWh');
    });

    it('should process gas records with conversion', async function () {
        const records = [
            { timestamp: 1672531200000, value: 1000, dateObj: new Date('2023-01-01T00:00:00') },
            { timestamp: 1704063600000, value: 2000, dateObj: new Date('2023-12-31T23:00:00') },
        ];

        // 1000 m3 * 10 (Brennwert) * 1 (Z-Zahl) = 10000 kWh
        const stats = await manager.processRecords('gas', records);
        expect(stats.yearsUpdated).to.include('2023');
        expect(stats.details[0].consumption).to.equal(10000);
        expect(stats.details[0].unit).to.equal('kWh');
    });

    it('should process custom meter with custom unit', async function () {
        const records = [
            { timestamp: 1672531200000, value: 100, dateObj: new Date('2023-01-01T00:00:00') },
            { timestamp: 1704063600000, value: 200, dateObj: new Date('2023-12-31T23:00:00') },
        ];

        const stats = await manager.processRecords('gartenhaus', records, 'm³');
        expect(stats.yearsUpdated).to.include('2023');
        expect(stats.details[0].consumption).to.equal(100);
        expect(stats.details[0].unit).to.equal('m³');
    });
});
