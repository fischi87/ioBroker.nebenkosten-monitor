/**
 * Unit tests for calculator module
 */

const { expect } = require('chai');
const calculator = require('../../lib/calculator');

describe('Calculator Module', () => {
    describe('convertGasM3ToKWh()', () => {
        it('should convert m³ to kWh correctly with default values', () => {
            const result = calculator.convertGasM3ToKWh(100);
            // 100 * 11.5 * 0.95 = 1092.5
            expect(result).to.equal(1092.5);
        });

        it('should convert m³ to kWh with custom brennwert and zZahl', () => {
            const result = calculator.convertGasM3ToKWh(50, 12.0, 0.98);
            // 50 * 12.0 * 0.98 = 588
            expect(result).to.equal(588);
        });

        it('should handle zero consumption', () => {
            const result = calculator.convertGasM3ToKWh(0);
            expect(result).to.equal(0);
        });

        it('should throw TypeError for non-number inputs', () => {
            // @ts-ignore - Intentionally testing with wrong types
            expect(() => calculator.convertGasM3ToKWh('100')).to.throw(TypeError);
            // @ts-ignore - Intentionally testing with wrong types
            expect(() => calculator.convertGasM3ToKWh(100, '11.5')).to.throw(TypeError);
            // @ts-ignore - Intentionally testing with wrong types
            expect(() => calculator.convertGasM3ToKWh(100, 11.5, '0.95')).to.throw(TypeError);
        });

        it('should throw RangeError for negative consumption', () => {
            expect(() => calculator.convertGasM3ToKWh(-10)).to.throw(RangeError);
        });

        it('should throw RangeError for invalid brennwert', () => {
            expect(() => calculator.convertGasM3ToKWh(100, 0)).to.throw(RangeError);
            expect(() => calculator.convertGasM3ToKWh(100, -5)).to.throw(RangeError);
        });

        it('should throw RangeError for invalid zZahl', () => {
            expect(() => calculator.convertGasM3ToKWh(100, 11.5, 0)).to.throw(RangeError);
            expect(() => calculator.convertGasM3ToKWh(100, 11.5, 1.5)).to.throw(RangeError);
        });
    });

    describe('getCurrentPrice()', () => {
        it('should return correct price object', () => {
            const result = calculator.getCurrentPrice(0.15, 12.5);
            expect(result).to.deep.equal({
                price: 0.15,
                basicCharge: 12.5,
            });
        });

        it('should handle zero price', () => {
            const result = calculator.getCurrentPrice(0, 10);
            expect(result).to.deep.equal({
                price: 0,
                basicCharge: 10,
            });
        });

        it('should handle missing basicCharge', () => {
            const result = calculator.getCurrentPrice(0.2);
            expect(result).to.deep.equal({
                price: 0.2,
                basicCharge: 0,
            });
        });

        it('should handle null/undefined price', () => {
            // @ts-ignore - Intentionally testing with null
            const result = calculator.getCurrentPrice(null, 15);
            expect(result).to.deep.equal({
                price: 0,
                basicCharge: 15,
            });
        });
    });

    describe('calculateCost()', () => {
        it('should calculate cost correctly', () => {
            const result = calculator.calculateCost(730.01, 0.1885);
            // 730.01 * 0.1885 = 137.60688 ≈ 137.61
            expect(result).to.be.closeTo(137.61, 0.01);
        });

        it('should handle zero consumption', () => {
            const result = calculator.calculateCost(0, 0.2);
            expect(result).to.equal(0);
        });

        it('should handle zero price', () => {
            const result = calculator.calculateCost(100, 0);
            expect(result).to.equal(0);
        });

        it('should handle null/undefined price', () => {
            // @ts-ignore - Intentionally testing with null
            const result = calculator.calculateCost(100, null);
            expect(result).to.equal(0);
        });

        it('should throw TypeError for negative consumption', () => {
            expect(() => calculator.calculateCost(-50, 0.15)).to.throw(TypeError);
        });

        it('should throw TypeError for non-number consumption', () => {
            // @ts-ignore - Intentionally testing with wrong type
            expect(() => calculator.calculateCost('100', 0.15)).to.throw(TypeError);
        });

        it('should handle realistic gas calculation', () => {
            // Real example: 730 kWh @ 0.1835 €/kWh
            const result = calculator.calculateCost(730, 0.1835);
            expect(result).to.be.closeTo(133.955, 0.001);
        });
    });

    describe('roundToDecimals()', () => {
        it('should round to 2 decimals by default', () => {
            expect(calculator.roundToDecimals(137.60688)).to.equal(137.61);
            expect(calculator.roundToDecimals(15.034)).to.equal(15.03);
            expect(calculator.roundToDecimals(2.645)).to.equal(2.65);
        });

        it('should round to specified decimal places', () => {
            expect(calculator.roundToDecimals(137.60688, 1)).to.equal(137.6);
            expect(calculator.roundToDecimals(137.60688, 0)).to.equal(138);
            expect(calculator.roundToDecimals(137.60688, 3)).to.equal(137.607);
        });

        it('should handle whole numbers', () => {
            expect(calculator.roundToDecimals(150, 2)).to.equal(150);
        });

        it('should handle negative numbers', () => {
            expect(calculator.roundToDecimals(-24.673, 2)).to.equal(-24.67);
        });

        it('should handle zero', () => {
            expect(calculator.roundToDecimals(0, 2)).to.equal(0);
        });
    });

    describe('Integration Tests', () => {
        it('should calculate complete gas cost correctly', () => {
            // Real-world scenario:
            // Consumption: 66.82 m³
            // Brennwert: 11.5, Z-Zahl: 0.95
            // Price: 0.1885 €/kWh
            // Basic charge: 15.03 €/month × 1 month

            const volumeM3 = 66.82;
            const consumptionKWh = calculator.convertGasM3ToKWh(volumeM3, 11.5, 0.95);
            expect(consumptionKWh).to.be.closeTo(730.01, 0.1);

            const verbrauchskosten = calculator.calculateCost(consumptionKWh, 0.1885);
            expect(verbrauchskosten).to.be.closeTo(137.61, 0.1);

            const grundgebuehr = 15.03;
            const gesamtkosten = verbrauchskosten + grundgebuehr;
            expect(gesamtkosten).to.be.closeTo(152.64, 0.1);

            const abschlag = 150;
            const balance = gesamtkosten - abschlag;
            expect(balance).to.be.closeTo(2.64, 0.1);
        });

        it('should handle water cost calculation', () => {
            // Water: 10.5 m³ @ 2.08 €/m³ + 15.00 € Grundgebühr
            const consumption = 10.5;
            const price = 2.08;
            const basicCharge = 15.0;

            const verbrauchskosten = calculator.calculateCost(consumption, price);
            expect(verbrauchskosten).to.equal(21.84);

            const gesamtkosten = verbrauchskosten + basicCharge;
            expect(gesamtkosten).to.equal(36.84);
        });

        it('should calculate balance correctly (positive = Nachzahlung)', () => {
            const costs = 152.64;
            const paid = 150;
            const balance = costs - paid;
            expect(balance).to.be.closeTo(2.64, 0.01); // Positive = Nachzahlung
        });

        it('should calculate balance correctly (negative = Guthaben)', () => {
            const costs = 125.5;
            const paid = 150;
            const balance = costs - paid;
            expect(balance).to.be.closeTo(-24.5, 0.01); // Negative = Guthaben
        });
    });
});
