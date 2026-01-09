'use strict';

/**
 * Abstract base class for importers
 */
class AbstractImporter {
    /**
     * @param {object} adapter - Adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * Parses the CSV content
     *
     * @param {string} _content - Raw CSV string
     * @returns {Promise<Array<{timestamp: number, value: number}>>} - Array of objects with timestamp and value
     */
    async parse(_content) {
        throw new Error('Method "parse" must be implemented');
    }

    /**
     * Validates if the content matches this importer
     *
     * @param {string} _content - Raw content to validate
     * @returns {boolean} - True if valid, false otherwise
     */
    validate(_content) {
        return false;
    }
}

module.exports = AbstractImporter;
