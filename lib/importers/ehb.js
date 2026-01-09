'use strict';

const AbstractImporter = require('./abstractImporter');

/**
 * Importer for "Energie Haushalts Buch" (EhB) App
 * Format assumption: German CSV (semicolon separator)
 * Date;Value;Comment
 * 01.01.2023 12:00;1234.5;Ablesung
 */
class EhbImporter extends AbstractImporter {
    /**
     * Parse the CSV content
     *
     * @param {string} content - Raw content
     * @returns {Promise<Array<any>>} - Parsed results
     */
    async parse(content) {
        const results = [];
        // Regex to match: Date;Value;Comment
        // Supports:
        // DD.MM.YYYY or DD.MM.YYYY HH:mm
        // Semicolon separator
        // Value with dot or comma
        // Optional comment
        const regex = /(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)\s*;\s*(\d+(?:[.,]\d+)?)/g;

        let match;
        while ((match = regex.exec(content)) !== null) {
            const dateStr = match[1].trim();
            const valueStr = match[2].trim().replace(',', '.');

            const date = this.parseGermanDate(dateStr);
            const value = parseFloat(valueStr);

            if (date && !isNaN(value)) {
                results.push({
                    timestamp: date.getTime(),
                    value: value,
                    dateObj: date,
                });
            }
        }

        // Sort by date ascending
        if (results.length > 0) {
            results.sort((a, b) => a.timestamp - b.timestamp);
        }

        return results;
    }

    /**
     * Parse german date string
     *
     * @param {string} dateStr - Date string
     * @returns {Date|null} - Date object or null
     */
    parseGermanDate(dateStr) {
        try {
            // Check for time component
            let timeStr = '00:00:00';
            let dStr = dateStr;

            if (dateStr.includes(' ')) {
                const parts = dateStr.split(/\s+/); // Handle multiple spaces
                dStr = parts[0];
                if (parts[1]) {
                    timeStr = parts[1];
                    // Add seconds if missing
                    if (timeStr.split(':').length === 2) {
                        timeStr += ':00';
                    }
                }
            }

            const [day, month, year] = dStr.split('.');
            // Simple check
            if (!day || !month || !year) {
                return null;
            }

            // Create ISO string YYYY-MM-DDTHH:mm:ss
            return new Date(`${year}-${month}-${day}T${timeStr}`);
        } catch {
            return null;
        }
    }
}

module.exports = EhbImporter;
