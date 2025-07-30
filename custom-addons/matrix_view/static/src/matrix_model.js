/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { Domain } from "@web/core/domain";
import { cartesian, sections, sortBy, symmetricalDifference } from "@web/core/utils/arrays";
import { KeepLast, Race } from "@web/core/utils/concurrency";
import { DEFAULT_INTERVAL } from "@web/search/utils/dates";
import { Model } from "@web/model/model";
import { computeReportMeasures, processMeasure } from "@web/views/utils";
import { useService } from "@web/core/utils/hooks";
import { useDateTimePicker } from "@web/core/datetime/datetime_hook";
import {
    areDatesEqual,
    deserializeDate,
    deserializeDateTime,
    formatDate,
    formatDateTime,
    today,
    parseDate,
    parseDateTime,
} from "@web/core/l10n/dates";
import { localization } from "@web/core/l10n/localization";
const { DateTime } = luxon;
const MONTHS = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};
/**
 * @param {number} value
 * @param {number} comparisonValue
 * @returns {number}
 */
function computeVariation(value, comparisonValue) {
    if (isNaN(value) || isNaN(comparisonValue)) {
        return NaN;
    }
    if (comparisonValue === 0) {
        if (value === 0) {
            return 0;
        } else if (value > 0) {
            return 1;
        } else {
            return -1;
        }
    }
    return (value - comparisonValue) / Math.abs(comparisonValue);
}


/**
 * @typedef Meta
 * @property {string[]} activeMeasures
 * @property {string[]} colGroupBys
 * @property {boolean} disableLinking
 * @property {Object} fields
 * @property {Object} measures
 * @property {string} resModel
 * @property {string[]} rowGroupBys
 * @property {string} title
 * @property {boolean} useSampleModel
 * @property {Object} widgets
 * @property {Map} customGroupBys
 * @property {string[]} expandedRowGroupBys
 * @property {string[]} expandedColGroupBys
 * @property {Object} sortedColumn
 * @property {Array[]} domains
 * @property {string[]} origins
 */

/**
 * @typedef Data
 * @property {Object} colGroupTree
 * @property {Object} rowGroupTree
 * @property {Object} groupDomains
 * @property {Object} measurements
 * @property {Object} counts
 * @property {Object} numbering
 */

/**
 * @typedef {import("@web/search/search_model").SearchParams} SearchParams
 */

/**
 * @typedef Config
 * @property {MetaData} metaData
 * @property {Data} data
 */

export class MatrixModel extends Model {
    /**
     * @override
     * @param {Object} params.metaData
     * @param {string[]} params.metaData.activeMeasures
     * @param {string[]} params.metaData.colGroupBys
     * @param {Object} params.metaData.fields
     * @param {Object[]} params.metaData.measures
     * @param {string} params.metaData.resModel
     * @param {string[]} params.metaData.rowGroupBys
     * @param {string|null} params.metaData.defaultOrder
     * @param {boolean} params.metaData.disableLinking
     * @param {boolean} params.metaData.useSampleModel
     * @param {Map} [params.metaData.customGroupBys={}]
     * @param {string[]} [params.metaData.expandedColGroupBys=[]]
     * @param {string[]} [params.metaData.expandedRowGroupBys=[]]
     * @param {Object|null} [params.metaData.sortedColumn=null]
     * @param {Object} [params.data] previously exported data
     */
    setup(params) {
        // concurrency management¨
        this.orm = params.orm || useService("orm");
        this.keepLast = new KeepLast();
        this.race = new Race();
        const _loadData = this._loadData.bind(this);
        this._loadData = (...args) => {
            return this.race.add(_loadData(...args));
        };
        let sortedColumn = params.metaData.sortedColumn || null;
        if (!sortedColumn && params.metaData.defaultOrder) {
            const defaultOrder = params.metaData.defaultOrder.split(" ");
            sortedColumn = {
                groupId: [[], []],
                measure: defaultOrder[0],
                order: defaultOrder[1] ? defaultOrder[1] : "asc",
            };
        }

        this.searchParams = {
            context: {},
            domain: [],
            domains: [],
            groupBy: [],
        };
        this.data = params.data || {
            colGroupTree: null,
            rowGroupTree: null,
            groupDomains: {},
            measurements: {},
            counts: {},
            numbering: {},
            newRows: [],
            dynamicColumns: new Map(),
            copiedRow:null,
        };
        if (!Array.isArray(this.data.newRows)) {
            this.data.newRows = [];
        }
        const metaData = Object.assign({}, params.metaData, {
            customGroupBys: params.metaData.customGroupBys || new Map(),
            expandedRowGroupBys: params.metaData.expandedRowGroupBys || [],
            expandedColGroupBys: params.metaData.expandedColGroupBys || [],
            sortedColumn,
        });
        this.metaData = this._buildMetaData(metaData);

        this.reload = false; // used to discriminate between the first load and subsequent reloads
        this.nextActiveMeasures = null; // allows to toggle several measures consecutively

        //this.data.newColumns = params.data?.newColumns || [];
        this.data.dynamicColumns = params.data?.dynamicColumns || new Map();
    }

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------
    /*formatDateModel(value, fieldType) {
        // if (!value) return '';
        //  const date = new Date(value);
        //  if (fieldType === 'datetime') {
        //      return formatDateTime(deserializeDateTime(date), { format: localization.dateFormat });
        //  } else {
        //      return formatDate(deserializeDate(date), { format: localization.dateFormat });
        //  }
     
        // if (!value) return '';
        // console.log(`Formatting date value: ${value} (${typeof value}) for fieldType: ${fieldType}`);
        // //const dateTimePicker = useDateTimePicker();
        // value=new Date(value);
        // const dateFormatted = value? fieldType === "date"? formatDate(deserializeDate(value)): formatDateTime(deserializeDateTime(value)): "";
        // console.log(`Formatted date: ${dateFormatted}`);
        // //const dateTimePickerFormatted = dateTimePicker.formatDate(deserializeDate(value));
        // //console.log(`DateTimePicker formatted date: ${dateTimePickerFormatted}`);
        // return dateFormatted;
        // if (fieldType === 'date') {
        //     return dateTimePicker.formatDate(deserializeDate(value));
        // }
        // if (fieldType === 'datetime') {
        //     return dateTimePicker.formatDateTime(deserializeDateTime(value));
        // }
        // return 
        if (!value) return '';
        console.log(`Formatting date value: ${value} (${typeof value}) for fieldType: ${fieldType}`);
        let formattedDate = value;
        let dateValue = value.split(' ');
        console.log(`Parsed date value: ${dateValue}`);
        if (dateValue.length > 1) {
            formattedDate = new Date(Date.UTC(parseInt(dateValue[2]), MONTHS[dateValue[1]], parseInt(dateValue[0]),0,0,0));
            const timezoneOffsetMinutes = new Date().getTimezoneOffset();
            const timezoneOffsetMilliseconds = timezoneOffsetMinutes * 60 * 1000;
            const adjustedTimestamp = formattedDate.getTime() + timezoneOffsetMilliseconds;
            formattedDate = new Date(adjustedTimestamp);
        }
        
        console.log(`Formatted date: ${formattedDate}`);
        const pad = (n) => String(n).padStart(2, '0');
        if (fieldType === 'datetime') {
            try{
                return formattedDate.toISOString().slice(0, 19).replace('T', ' ');
            } catch (error) {
                return value;
            }
            //return `${formattedDate.getFullYear()}-${pad(formattedDate.getMonth() + 1)}-${pad(formattedDate.getDate())} ${pad(formattedDate.getHours())}:${pad(formattedDate.getMinutes())}:${pad(formattedDate.getSeconds())}`;
        }
        else {
            try{
                return formattedDate.toISOString().split('T')[0];
            } catch (error) {
                return value;
            }
            //return `${formattedDate.getFullYear()}-${pad(formattedDate.getMonth() + 1)}-${pad(formattedDate.getDate())}`;
        }
    }*/
    formatDateModel(value, fieldType) {
        if (!value) return '';
        const parts = value.split(' ');
        if (parts.length< 3){
            return value; // Invalid date format, return as is
        }
        const day = parseInt(parts[0], 10);
        const month = MONTHS[parts[1]];
        const year = parseInt(parts[2], 10);
        const formattedDate = new Date(Date.UTC(year, month, day));
        console.log(`Parsed date value: ${formattedDate}`);
        const pad = (n) => String(n).padStart(2, '0');
        if (fieldType === 'datetime') {
            //return formattedDate.toISOString().slice(0, 19).replace('T', ' ');
            return `${formattedDate.getUTCFullYear()}-${pad(formattedDate.getUTCMonth() + 1)}-${pad(formattedDate.getUTCDate())} ${pad(formattedDate.getHours())}:${pad(formattedDate.getMinutes())}:${pad(formattedDate.getSeconds())}`;
        }
        else {
            //return formattedDate.toISOString().split('T')[0];
            return `${formattedDate.getUTCFullYear()}-${pad(formattedDate.getUTCMonth() + 1)}-${pad(formattedDate.getUTCDate())}`;
        }
    }
    async addLine() {
        if (!Array.isArray(this.data.newRows)) {
            this.data.newRows = [];
        }
        const columns = this._getLeafColumns(this.data.colGroupTree);
        const subGroupMeasurements = columns.map(column => ({
            groupId: [[], column.groupId[1]],
            measure: column.measure,
            value: null,
            isBold: false,
            originIndexes: [0]
        }));

        const newRow = {
            id: `new_${Date.now()}`,
            data: await this._createEmptyRowData(),
            groupId: [[]],
            subGroupMeasurements: subGroupMeasurements,
            isNew: true,
        };
        
        this.data.newRows.unshift(newRow);
        this.notify();
    }

    
    async _createEmptyRowData() {
        const defaults = await this.orm.call(this.metaData.resModel, "default_get", [this.metaData.rowGroupBys.map(gb => gb.split(':')[0])]);
        for (const [key, val] of Object.entries(this.searchParams.context)) {
            if (key.startsWith("default_")) {
                const fieldName = key.slice(8);  // Remove "default_" prefix
                defaults[fieldName] = val;
            }
        }  
        const data = {};
        //this.metaData.rowGroupBys.forEach(groupBy => {
        for (const groupBy of this.metaData.rowGroupBys) {
            const fieldName = groupBy.split(':')[0];
            const field = this.metaData.fields[fieldName];
            let label='';
            let value = defaults[fieldName];
            if (field.type=='many2one' && defaults[fieldName]!== undefined) {
                let record = await this.orm.searchRead(field.relation,[['id','=',defaults[fieldName]]] , ["display_name"]);
                label= record.length > 0 ? record[0].display_name : '';
            }
            else if (field.type === 'date' || field.type === 'datetime') {
                label = this.formatDateModel(value, field.type);
                value = this.formatDateModel(value, field.type);
            }
            console.log(`Creating empty row data for field: ${fieldName}, value: ${value}, label: ${label}`);
            // Initialize with proper structure
            data[fieldName] = {
                //value: this._getDefaultValueForField(field),
                value: value,// || this._getDefaultValueForField(field),
                label: label,
                ...(this.data[fieldName] || {}) // Preserve existing data if any
            };
        }
        return data;
    }
    
    /**
     * Add a groupBy to rowGroupBys or colGroupBys according to provided type.
     *
     * @param {Object} params
     * @param {Array[]} params.groupId
     * @param {string} params.fieldName
     * @param {'row'|'col'} params.type
     * @param {boolean} [params.custom=false]
     * @param {string} [params.interval]
     */
    async addGroupBy(params) {
        if (this.race.getCurrentProm()) {
            return; // we are currently reloaded the table
        }

        const { groupId, fieldName, type, custom } = params;
        let { interval } = params;
        const metaData = this._buildMetaData();
        if (custom && !metaData.customGroupBys.has(fieldName)) {
            const field = metaData.fields[fieldName];
            if (!interval && ["date", "datetime"].includes(field.type)) {
                interval = DEFAULT_INTERVAL;
            }
            metaData.customGroupBys.set(fieldName, {
                ...field,
                id: fieldName,
            });
        }

        let groupBy = fieldName;
        if (interval) {
            groupBy = `${groupBy}:${interval}`;
        }
        if (type === "row") {
            metaData.expandedRowGroupBys.push(groupBy);
        } else {
            metaData.expandedColGroupBys.push(groupBy);
        }
        const config = { metaData, data: this.data };
        await this._expandGroup(groupId, type, config);
        this.metaData = metaData;
        this.notify();
    }
    /**
     * Close the group with id given by groupId. A type must be specified
     * in case groupId is [[], []] (the id of the group 'Total') because this
     * group is present in both colGroupTree and rowGroupTree.
     *
     * @param {Array[]} groupId
     * @param {'row'|'col'} type
     */
    closeGroup(groupId, type) {
        if (this.race.getCurrentProm()) {
            return; // we are currently reloading the table
        }

        let groupBys;
        let expandedGroupBys;
        let keyPart;
        let group;
        let tree;
        if (type === "row") {
            groupBys = this.metaData.rowGroupBys;
            expandedGroupBys = this.metaData.expandedRowGroupBys;
            tree = this.data.rowGroupTree;
            group = this._findGroup(this.data.rowGroupTree, groupId[0]);
            keyPart = 0;
        } else {
            groupBys = this.metaData.colGroupBys;
            expandedGroupBys = this.metaData.expandedColGroupBys;
            tree = this.data.colGroupTree;
            group = this._findGroup(this.data.colGroupTree, groupId[1]);
            keyPart = 1;
        }

        const groupIdPart = groupId[keyPart];
        const range = groupIdPart.map((_, index) => index);
        function keep(key) {
            const idPart = JSON.parse(key)[keyPart];
            return (
                range.some((index) => groupIdPart[index] !== idPart[index]) ||
                idPart.length === groupIdPart.length
            );
        }
        function omitKeys(object) {
            const newObject = {};
            for (const key in object) {
                if (keep(key)) {
                    newObject[key] = object[key];
                }
            }
            return newObject;
        }
        this.data.measurements = omitKeys(this.data.measurements);
        this.data.counts = omitKeys(this.data.counts);
        this.data.groupDomains = omitKeys(this.data.groupDomains);

        group.directSubTrees.clear();
        delete group.sortedKeys;
        var newGroupBysLength = this._getTreeHeight(tree) - 1;
        if (newGroupBysLength <= groupBys.length) {
            expandedGroupBys.splice(0);
            groupBys.splice(newGroupBysLength);
        } else {
            expandedGroupBys.splice(newGroupBysLength - groupBys.length);
        }
        this.notify();
    }
    /**
     * Reload the view with the current rowGroupBys and colGroupBys
     * This is the easiest way to expand all the groups that are not expanded
     */
    async expandAll() {
        const config = { metaData: this.metaData, data: this.data };
        await this._loadData(config, false);
        this.notify();
    }
    /**
     * Expand a group by using groupBy to split it and trigger a re-rendering.
     *
     * @param {Object} group
     * @param {'row'|'col'} type
     */
    async expandGroup(groupId, type) {
        if (this.race.getCurrentProm()) {
            return; // we are currently reloaded the table
        }

        const config = { metaData: this.metaData, data: this.data };
        await this._expandGroup(groupId, type, config);
        this.notify();
    }
    /**
     * Export model data in a form suitable for an easy encoding of the matrix
     * table in excell.
     *
     * @returns {Object}
     */
    exportData() {
        const measureCount = this.metaData.activeMeasures.length;
        const originCount = this.metaData.origins.length;

        const table = this.getTable();
        
        // process headers
        const headers = table.headers;
        let colGroupHeaderRows;
        let measureRow = [];
        let originRow = [];

        function processHeader(header) {
            const inTotalColumn = header.groupId[1].length === 0;
            return {
                title: header.title,
                width: header.width,
                height: header.height,
                is_bold: !!header.measure && inTotalColumn,
            };
        }

        if (originCount > 1) {
            colGroupHeaderRows = headers.slice(0, headers.length - 2);
            measureRow = headers[headers.length - 2].map(processHeader);
            originRow = headers[headers.length - 1].map(processHeader);
        } else {
            colGroupHeaderRows = headers.slice(0, headers.length - 1);
            measureRow = headers[headers.length - 1].map(processHeader);
        }

        // remove the empty headers on left side
        colGroupHeaderRows[0].splice(0, 1);

        colGroupHeaderRows = colGroupHeaderRows.map((headerRow) => {
            return headerRow.map(processHeader);
        });

        // process rows
        const tableRows = table.rows.map((row) => {
            return {
                title: row.title,
                indent: row.indent,
                values: row.subGroupMeasurements.map((measurement) => {
                    let value = measurement.value;
                    if (value === undefined) {
                        value = "";
                    } else if (measurement.originIndexes.length > 1) {
                        // in that case the value is a variation and a
                        // number between 0 and 1
                        value = value * 100;
                    }
                    return {
                        is_bold: measurement.isBold,
                        value: value,
                    };
                }),
            };
        });

        return {
            model: this.metaData.resModel,
            title: this.metaData.title,
            col_group_headers: colGroupHeaderRows,
            measure_headers: measureRow,
            origin_headers: originRow,
            rows: tableRows,
            measure_count: measureCount,
            origin_count: originCount,
        };
    }
    /**
     * Swap the matrix columns and the rows. The flip operation is synchronous.
     * However, we must wait for a potential pending reload to complete before
     * flipping the axes. This method is thus async.
     */
    async flip() {
        await this.race.getCurrentProm();

        // swap the data: the main column and the main row
        let temp = this.data.rowGroupTree;
        this.data.rowGroupTree = this.data.colGroupTree;
        this.data.colGroupTree = temp;

        // we need to update the record metaData: (expanded) row and col groupBys
        temp = this.metaData.rowGroupBys;
        this.metaData.rowGroupBys = this.metaData.colGroupBys;
        this.metaData.colGroupBys = temp;
        temp = this.metaData.expandedColGroupBys;
        this.metaData.expandedColGroupBys = this.metaData.expandedRowGroupBys;
        this.metaData.expandedRowGroupBys = temp;

        function twistKey(key) {
            return JSON.stringify(JSON.parse(key).reverse());
        }

        function twist(object) {
            const newObject = {};
            Object.keys(object).forEach((key) => {
                const value = object[key];
                newObject[twistKey(key)] = value;
            });
            return newObject;
        }

        this.data.measurements = twist(this.data.measurements);
        this.data.counts = twist(this.data.counts);
        this.data.groupDomains = twist(this.data.groupDomains);

        this.notify();
    }
    /**
     * Returns a domain representation of a group
     *
     * @param {Object} group
     * @param {Array} group.colValues
     * @param {Array} group.rowValues
     * @param {number} group.originIndex
     * @returns {Array[]}
     */
    getGroupDomain(group) {
        const config = { metaData: this.metaData, data: this.data };
        return this._getGroupDomain(group, config);
    }
    /**
     * Returns a description of the matrix table.
     *
     * @returns {Object}
     */
    
    getTable() {
        const headers = this._getTableHeaders();
        const modelRows = this._getTableRows(this.data.rowGroupTree, this._getLeafColumns(this.data.colGroupTree))
            .filter(row => !(row.title === "Total" && row.indent === 0)).sort((a, b) => {
                const defaultOrder=this.metaData.defaultOrder;
                if (defaultOrder) {
                    const [field, order] = defaultOrder.split(" ");
                    return a.data[field].label.localeCompare(b.data[field].label) * (order === "asc" ? 1 : -1);
                }
            });
        
        return {
            headers: headers,
            rows: [...(this.data.newRows || []), ...modelRows]
        };
    }
    
    _getLeafColumns(tree) {
        const columns = [];
        const traverse = (node) => {
            if (node.directSubTrees.size === 0) {
                // Leaf node: add columns for all measures
                this.metaData.activeMeasures.forEach(measure => {
                    columns.push({
                        groupId: [[], node.root.values],
                        measure: measure,
                        width: 1
                    });
                });
            } else {
                // Use sortedKeys if available
                const keys = node.sortedKeys || [...node.directSubTrees.keys()];
                keys.forEach(key => {
                    const subTree = node.directSubTrees.get(key);
                    traverse(subTree);
                });
            }
        };
        traverse(tree);
        return columns;
    }
    /**
     * Returns the total number of columns of the matrix table.
     *
     * @returns {integer}
     */
    getTableWidth() {
        var leafCounts = this._getLeafCounts(this.data.colGroupTree);
        return leafCounts[JSON.stringify(this.data.colGroupTree.root.values)] + 2;
    }
    /**
     * @returns {boolean} true iff there's no data in the table
     */
    hasData() {
        return this._hasData(this.data);
    }
    /**
     * @override
     * @param {SearchParams} searchParams
     */
    async load(searchParams) {
        this.data.newRows = [];
        this.data.copiedRow = null;
        this.searchParams = searchParams;
        const processedMeasures = processMeasure(searchParams.context.matrix_measures);
        const activeMeasures = processedMeasures || this.metaData.activeMeasures;
        const metaData = this._buildMetaData({ activeMeasures });
        if (!this.reload) {
            metaData.rowGroupBys =
                searchParams.context.matrix_row_groupby ||
                (searchParams.groupBy.length ? searchParams.groupBy : metaData.rowGroupBys);
            this.reload = true;
        } else {
            metaData.rowGroupBys = searchParams.groupBy.length
                ? searchParams.groupBy
                : searchParams.context.matrix_row_groupby || metaData.rowGroupBys;
        }
        metaData.colGroupBys =
            searchParams.context.matrix_column_groupby || this.metaData.colGroupBys;

        if (JSON.stringify(metaData.rowGroupBys) !== JSON.stringify(this.metaData.rowGroupBys)) {
            metaData.expandedRowGroupBys = [];
        }
        if (JSON.stringify(metaData.colGroupBys) !== JSON.stringify(this.metaData.colGroupBys)) {
            metaData.expandedColGroupBys = [];
        }

        const allActivesMeasures = new Set(this.metaData.activeMeasures);
        if (processedMeasures) {
            processedMeasures.forEach((e) => allActivesMeasures.add(e));
        }

        metaData.measures = computeReportMeasures(metaData.fields, metaData.fieldAttrs, [
            ...allActivesMeasures,
        ]);
        const config = { metaData, data: this.data,rowTotals:false,colTotals:false };
        
        return this._loadData(config);
    }
    /**
     * Sort the rows, depending on the values of a given column.  This is an
     * in-memory sort.
     *
     * @param {Object} sortedColumn
     * @param {number[]} sortedColumn.groupId
     */
    sortRows(sortedColumn) {
        if (this.race.getCurrentProm()) {
            return; // we are currently reloaded the table
        }

        const config = { metaData: this.metaData, data: this.data };
        this._sortRows(sortedColumn, config);

        this.notify();
    }
    /**
     * Toggle the active state for a given measure, then reload the data
     * if this turns out to be necessary.
     *
     * @param {string} fieldName
     * @returns {Promise}
     */
    async toggleMeasure(fieldName) {
        const metaData = this._buildMetaData();
        this.nextActiveMeasures = this.nextActiveMeasures || metaData.activeMeasures;
        metaData.activeMeasures = this.nextActiveMeasures;
        const index = metaData.activeMeasures.indexOf(fieldName);
        if (index !== -1) {
            // in this case, we already have all data in memory, no need to
            // actually reload a lesser amount of information (but still, we need
            // to wait in case there is a pending load)
            metaData.activeMeasures.splice(index, 1);
            await Promise.resolve(this.race.getCurrentProm());
            this.metaData = metaData;
        } else {
            metaData.activeMeasures.push(fieldName);
            const config = { metaData, data: this.data };
            await this._loadData(config);
            this.useSampleModel = false;
        }
        this.nextActiveMeasures = null;
        this.notify();
    }

    //--------------------------------------------------------------------------
    // Protected
    //--------------------------------------------------------------------------

    /**
     * Add labels/values in the provided groupTree. A new leaf is created in
     * the groupTree with a root object corresponding to the group with given
     * labels/values.
     *
     * @protected
     * @param {Object} groupTree, either this.data.rowGroupTree or this.data.colGroupTree
     * @param {string[]} labels
     * @param {Array} values
     */
    _addGroup(groupTree, labels, values) {
        let tree = groupTree;
        // we assume here that the group with value value.slice(value.length - 2) has already been added.
        values.slice(0, values.length - 1).forEach(function (value) {
            tree = tree.directSubTrees.get(value);
        });
        const value = values[values.length - 1];
        if (tree.directSubTrees.has(value)) {
            return;
        }
        tree.directSubTrees.set(value, {
            root: {
                labels: labels,
                values: values,
            },
            directSubTrees: new Map(),
        });
    }
    /**
     * Return a copy of this.metaData, extended with optional params. This is useful
     * for async methods that need to modify this.metaData, but it can't be done in
     * place directly for the model to be concurrency proof (so they work on a
     * copy and commit it at the end).
     *
     * @protected
     * @param {Object} params
     * @returns {Object}
     */
    _buildMetaData(params) {
        const metaData = Object.assign({}, this.metaData, params);
        metaData.activeMeasures = [...metaData.activeMeasures];
        metaData.colGroupBys = [...metaData.colGroupBys];
        metaData.rowGroupBys = [...metaData.rowGroupBys];
        metaData.expandedColGroupBys = [...metaData.expandedColGroupBys];
        metaData.expandedRowGroupBys = [...metaData.expandedRowGroupBys];
        metaData.customGroupBys = new Map([...metaData.customGroupBys]);
        // shallow copy sortedColumn because we never modify groupId in place
        metaData.sortedColumn = metaData.sortedColumn ? { ...metaData.sortedColumn } : null;
        if (this.searchParams.comparison) {
            const domains = this.searchParams.comparison.domains.slice().reverse();
            metaData.domains = domains.map((d) => d.arrayRepr);
            metaData.origins = domains.map((d) => d.description);
        } else {
            metaData.domains = [this.searchParams.domain];
            metaData.origins = [""];
        }
        Object.defineProperty(metaData, "fullColGroupBys", {
            get() {
                return metaData.colGroupBys.concat(metaData.expandedColGroupBys);
            },
        });
        Object.defineProperty(metaData, "fullRowGroupBys", {
            get() {
                return metaData.rowGroupBys.concat(metaData.expandedRowGroupBys);
            },
        });
        return metaData;
    }
    /**
     * Expand a group by using groupBy to split it.
     *
     * @protected
     * @param {Object} group
     * @param {'row'|'col'} type
     * @param {Config} config
     */
    async _expandGroup(groupId, type, config) {
        const { metaData } = config;
        const group = {
            rowValues: groupId[0],
            colValues: groupId[1],
            type: type,
        };
        const groupValues = type === "row" ? groupId[0] : groupId[1];
        const groupBys = type === "row" ? metaData.fullRowGroupBys : metaData.fullColGroupBys;
        if (groupValues.length >= groupBys.length) {
            throw new Error("Cannot expand group");
        }
        const groupBy = groupBys[groupValues.length];
        let leftDivisors;
        let rightDivisors;
        if (group.type === "row") {
            leftDivisors = [[groupBy]];
            rightDivisors = sections(metaData.fullColGroupBys);
        } else {
            leftDivisors = sections(metaData.fullRowGroupBys);
            rightDivisors = [[groupBy]];
        }
        const divisors = cartesian(leftDivisors, rightDivisors);
        delete group.type;
        await this._subdivideGroup(group, divisors, config);
    }
    /**
     * Find a group with given values in the provided groupTree, either
     * this.rowGrouptree or this.data.colGroupTree.
     *
     * @protected
     * @param {Object} groupTree
     * @param {Array} values
     * @returns {Object}
     */
    _findGroup(groupTree, values) {
        let tree = groupTree;
        values.slice(0, values.length).forEach((value) => {
            tree = tree.directSubTrees.get(value);
        });
        return tree;
    }
    /**
     * In case originIndex is an array of length 1, thus a single origin
     * index, returns the given measure for a group determined by the id
     * groupId and the origin index.
     * If originIndexes is an array of length 2, we compute the variation
     * of the measure values for the groups determined by groupId and the
     * different origin indexes.
     *
     * @protected
     * @param {Array[]} groupId
     * @param {string} measure
     * @param {number[]} originIndexes
     * @param {Config} config
     * @returns {number}
     */
    _getCellValue(groupId, measure, originIndexes, config) {
        var key = JSON.stringify(groupId);
        if (!config.data.measurements[key]) {
            return;
        }
        var values = originIndexes.map((originIndex) => {
            return config.data.measurements[key][originIndex][measure];
        });
        if (originIndexes.length > 1) {
            return computeVariation(values[1], values[0]);
        } else {
            return values[0];
        }
    }
    /**
     * @protected
     * @param {string[]} rowGroupBy
     * @param {string[]} colGroupBy
     * @returns {string[]}
     */
    _getGroupBySpecs(rowGroupBy, colGroupBy) {
        const set = rowGroupBy.concat(colGroupBy).reduce((acc, gb) => {
            acc.add(this._normalize(gb));
            return acc;
        }, new Set());
        return [...set];
    }
    /**
     * Returns a domain representation of a group
     *
     * @protected
     * @param {Object} group
     * @param {Array} group.colValues
     * @param {Array} group.rowValues
     * @param {number} group.originIndex
     * @param {Config} config
     * @returns {Array[]}
     */
    _getGroupDomain(group, config) {
        const { data } = config;
        var key = JSON.stringify([group.rowValues, group.colValues]);
        return data.groupDomains[key][group.originIndex];
    }
    /**
     * Returns the group sanitized labels.
     *
     * @protected
     * @param {Object} group
     * @param {string[]} groupBys
     * @param {Config} config
     * @returns {string[]}
     */
    _getGroupLabels(group, groupBys, config) {
        return groupBys.map((gb) => {
            const groupBy = this._normalize(gb);
            console.log(`Sanitizing label for groupBy: ${groupBy}, value: ${group[groupBy]} in group:`, group, config);
            return this._sanitizeLabel(group[groupBy], groupBy, config);
        });
    }
    /**
     * Returns a promise that returns the annotated read_group results
     * corresponding to a partition of the given group obtained using the given
     * rowGroupBy and colGroupBy.
     *
     * @protected
     * @param {Object} group
     * @param {string[]} rowGroupBy
     * @param {string[]} colGroupBy
     * @param {Config} config
     */
    async _getGroupSubdivision(group, rowGroupBy, colGroupBy, config) {
        const groupDomain = this._getGroupDomain(group, config);
        const measureSpecs = this._getMeasureSpecs(config);
        const groupBy = this._getGroupBySpecs(rowGroupBy, colGroupBy);
        const kwargs = { lazy: false, context: this.searchParams.context };
        const subGroups = await this.orm.readGroup(
            config.metaData.resModel,
            groupDomain,
            measureSpecs,
            groupBy,
            kwargs
        );
        return {
            group: group,
            subGroups: subGroups,
            rowGroupBy: rowGroupBy,
            colGroupBy: colGroupBy,
        };
    }
    /**
     * Returns the group sanitized values.
     *
     * @protected
     * @param {Object} group
     * @param {string[]} groupBys
     * @returns {Array}
     */
    _getGroupValues(group, groupBys) {
        return groupBys.map((gb) => {
            const groupBy = this._normalize(gb);
            return this._sanitizeValue(group[groupBy]);
        });
    }
    /**
     * Returns the leaf counts of each group inside the given tree.
     *
     * @protected
     * @param {Object} tree
     * @returns {Object} keys are group ids
     */
    _getLeafCounts(tree) {
        const leafCounts = {};
        let leafCount;
        if (!tree.directSubTrees.size) {
            leafCount = 1;
        } else {
            leafCount = [...tree.directSubTrees.values()].reduce((acc, subTree) => {
                const subLeafCounts = this._getLeafCounts(subTree);
                Object.assign(leafCounts, subLeafCounts);
                return acc + leafCounts[JSON.stringify(subTree.root.values)];
            }, 0);
        }

        leafCounts[JSON.stringify(tree.root.values)] = leafCount;
        return leafCounts;
    }
    /**
     * Returns the group sanitized measure values for the measures in
     * this.metaData.activeMeasures (that migth contain '__count', not really a fieldName).
     *
     * @protected
     * @param {Object} group
     * @param {Config} config
     * @returns {Array}
     */
    _getMeasurements(group, config) {
        const { metaData } = config;
        return metaData.activeMeasures.reduce((measurements, measureName) => {
            var measurement = group[measureName];
            if (measurement instanceof Array) {
                // case field is many2one and used as measure and groupBy simultaneously
                measurement = 1;
            }
            if (
                metaData.measures[measureName].type === "boolean" &&
                measurement instanceof Boolean
            ) {
                measurement = measurement ? 1 : 0;
            }
            if (metaData.origins.length > 1 && !measurement) {
                measurement = 0;
            }
            measurements[measureName] = measurement;
            return measurements;
        }, {});
    }
    /**
     * Returns a description of the measures row of the matrix table
     *
     * @protected
     * @param {Object[]} columns for which measure cells must be generated
     * @returns {Object[]}
     */
    _getMeasuresRow(columns) {
        const sortedColumn = this.metaData.sortedColumn || {};
        const measureRow = [];

        columns.forEach((column) => {
            this.metaData.activeMeasures.forEach((measureName) => {
                const measureCell = {
                    groupId: column.groupId,
                    height: 1,
                    measure: measureName,
                    title: this.metaData.measures[measureName].string,
                    width: 2 * this.metaData.origins.length - 1,
                };
                if (
                    sortedColumn.measure === measureName &&
                    JSON.stringify(sortedColumn.groupId) === JSON.stringify(column.groupId) // FIXME
                ) {
                    measureCell.order = sortedColumn.order;
                }
                measureRow.push(measureCell);
            });
        });

        return measureRow;
    }
    /**
     * Returns the list of measure specs associated with metaData.activeMeasures, i.e.
     * a measure 'fieldName' becomes 'fieldName:groupOperator' where
     * groupOperator is the value specified on the field 'fieldName' for
     * the key group_operator.
     *
     * @protected
     * @param {Config} config
     * @return {string[]}
     */
    _getMeasureSpecs(config) {
        const { metaData } = config;
        return metaData.activeMeasures.reduce((acc, measure) => {
            if (measure === "__count") {
                acc.push(measure);
                return acc;
            }
            const field = this.metaData.fields[measure];
            if (field.type === "many2one") {
                field.group_operator = "count_distinct";
            }
            if (field.group_operator === undefined) {
                throw new Error(
                    "No aggregate function has been provided for the measure '" + measure + "'"
                );
            }
            acc.push(measure + ":" + field.group_operator);
            return acc;
        }, []);
    }
    /**
     * Make sure that the labels of different many2one values are distinguished
     * by numbering them if necessary.
     *
     * @protected
     * @param {Array} label
     * @param {string} fieldName
     * @param {Config} config
     * @returns {string}
     */
    _getNumberedLabel(label, fieldName, config) {
        const { data } = config;
        const id = label[0];
        const name = label[1];
        data.numbering[fieldName] = data.numbering[fieldName] || {};
        data.numbering[fieldName][name] = data.numbering[fieldName][name] || {};
        const numbers = data.numbering[fieldName][name];
        numbers[id] = numbers[id] || Object.keys(numbers).length + 1;
        return name + (numbers[id] > 1 ? "  (" + numbers[id] + ")" : "");
    }
    /**
     * Returns a description of the origins row of the matrix table
     *
     * @protected
     * @param {Object[]} columns for which origin cells must be generated
     * @returns {Object[]}
     */
    _getOriginsRow(columns) {
        const sortedColumn = this.metaData.sortedColumn || {};
        const originRow = [];

        columns.forEach((column) => {
            const groupId = column.groupId;
            const measure = column.measure;
            const isSorted =
                sortedColumn.measure === measure &&
                JSON.stringify(sortedColumn.groupId) === JSON.stringify(groupId); // FIXME
            const isSortedByOrigin = isSorted && !sortedColumn.originIndexes[1];
            const isSortedByVariation = isSorted && sortedColumn.originIndexes[1];

            this.metaData.origins.forEach((origin, originIndex) => {
                const originCell = {
                    groupId: groupId,
                    height: 1,
                    measure: measure,
                    originIndexes: [originIndex],
                    title: origin,
                    width: 1,
                };
                if (isSortedByOrigin && sortedColumn.originIndexes[0] === originIndex) {
                    originCell.order = sortedColumn.order;
                }
                originRow.push(originCell);

                if (originIndex > 0) {
                    const variationCell = {
                        groupId: groupId,
                        height: 1,
                        measure: measure,
                        originIndexes: [originIndex - 1, originIndex],
                        title: _t("Variation"),
                        width: 1,
                    };
                    if (isSortedByVariation && sortedColumn.originIndexes[1] === originIndex) {
                        variationCell.order = sortedColumn.order;
                    }
                    originRow.push(variationCell);
                }
            });
        });

        return originRow;
    }
    /**
     * Returns the list of header rows of the matrix table: the col group rows
     * (depending on the col groupbys), the measures row and optionnaly the
     * origins row (if there are more than one origins).
     *
     * @protected
     * @returns {Object[]}
     */
    _getTableHeaders() {
        const colGroupBys = this.metaData.fullColGroupBys;
        const height = colGroupBys.length + 1;
        const measureCount = this.metaData.activeMeasures.length;
        const originCount = this.metaData.origins.length;
        const leafCounts = this._getLeafCounts(this.data.colGroupTree);
        let headers = [];
        const measureColumns = []; // used to generate the measure cells

        // 1) generate col group rows (total row + one row for each col groupby)
        const colGroupRows = new Array(height).fill(0).map(() => []);
        // blank top left cell
        /*colGroupRows[0].push({
            height: height + 1 + (originCount > 1 ? 1 : 0), // + measures rows [+ origins row]
            title: "",
            width: 1,
        });*/
        // col groupby cells with group values
        /**
         * Recursive function that generates the header cells corresponding to
         * the groups of a given tree.
         *
         * @param {Object} tree
         */
        function generateTreeHeaders(tree, fields) {
            
            const group = tree.root;
            const rowIndex = group.values.length;
            const row = colGroupRows[rowIndex];
            const groupId = [[], group.values];
            const isLeaf = !tree.directSubTrees.size;
            const leafCount = leafCounts[JSON.stringify(tree.root.values)];
            const fieldType=rowIndex === 0
                        ? undefined
                        : fields[colGroupBys[rowIndex - 1].split(":")[0]].type;
            const cell = {
                groupId: groupId,
                height: isLeaf ? colGroupBys.length + 1 - rowIndex : 1,
                isLeaf: isLeaf,
                isFolded: isLeaf && colGroupBys.length > group.values.length,
                label:
                    rowIndex === 0
                        ? undefined
                        : fields[colGroupBys[rowIndex - 1].split(":")[0]].string,
                title: group.labels.length ? fieldType==='json'?JSON.stringify(group.labels[group.labels.length - 1]):group.labels[group.labels.length - 1] : _t("Total"),
                width: leafCount * measureCount * (2 * originCount - 1),
                name:rowIndex === 0
                        ? undefined
                        : fields[colGroupBys[rowIndex - 1].split(":")[0]].name,
                fieldId:rowIndex === 0
                        ? undefined
                        : group.values[0],
                fieldType:rowIndex === 0
                        ? undefined
                        : fields[colGroupBys[rowIndex - 1].split(":")[0]].type,
            };
            if (group.labels.length){
                row.push(cell);
            }
            
            if (isLeaf) {
                measureColumns.push(cell);
            }

            /*[...tree.directSubTrees.values()].forEach((subTree) => {
                generateTreeHeaders(subTree, fields);
            });*/
            const keys = tree.sortedKeys || [...tree.directSubTrees.keys()];
    
            keys.forEach((key) => {
                const subTree = tree.directSubTrees.get(key);
                if (subTree) {
                    generateTreeHeaders(subTree, fields);
                }
            });
        }
        generateTreeHeaders(this.data.colGroupTree, this.metaData.fields);
        // blank top right cell for 'Total' group (if there is more that one leaf)
        if (leafCounts[JSON.stringify(this.data.colGroupTree.root.values)] > 1) {
            var groupId = [[], []];
            var totalTopRightCell = {
                groupId: groupId,
                height: height,
                title: "",
                width: measureCount * (2 * originCount - 1),
            };
            //colGroupRows[0].push(totalTopRightCell);
            //measureColumns.push(totalTopRightCell);
        }
        headers = headers.concat(colGroupRows);

        // 2) generate measures row
        var measuresRow = this._getMeasuresRow(measureColumns);
        //headers.push(measuresRow);

        // 3) generate origins row if more than one origin
        if (originCount > 1) {
            headers.push(this._getOriginsRow(measuresRow));
        }
        
        return headers;
    }
    
    /**
     * Returns the list of body rows of the matrix table for a given tree.
     *
     * @protected
     * @param {Object} tree
     * @param {Object[]} columns
     * @returns {Object[]}
     */
    
    _getTableRows(tree, columns) {
        const rows = [];
        const rowGroupBys = this.metaData.fullRowGroupBys;
        
        const flattenTree = (node, currentRow = {}) => {
            const group = node.root;
            console.log("Flattening node:", group);
            console.log("Row group values:", group.values);
            console.log("Current row before adding group values:", currentRow);
            // Add current level's data to the row
            if (group.values.length > 0) {
                const fieldName = rowGroupBys[group.values.length - 1].split(':')[0];
                currentRow[fieldName] = {
                    value: group.values[group.values.length - 1],
                    label: group.labels[group.labels.length - 1]
                };
            }
            console.log("Current row after adding group values:", currentRow);
            console.log("Node directSubTrees:", node.directSubTrees);
            if (node.directSubTrees.size === 0) {
                // Leaf node: create a row
                const row = {
                    id: group.id,
                    data: {...currentRow},
                    groupId: [group.values, []],
                    subGroupMeasurements: [],
                    edited: false,
                    isEditing: false,
                };
                
                // Get sorted columns for this row
                const sortedColumns = this._getSortedColumnsForRow(group.values, columns);
                
                // Create cells in sorted order
                sortedColumns.forEach(column => {
                    const colGroupId = column.groupId;
                    const groupIntersectionId = [group.values, colGroupId[1]];
                    const measure = column.measure;
                    const originIndexes = column.originIndexes || [0];
                    const value = this._getCellValue(groupIntersectionId, measure, originIndexes, {
                        data: this.data,
                    });
                    
                    row.subGroupMeasurements.push({
                        id: groupIntersectionId,
                        groupId: groupIntersectionId,
                        originIndexes: originIndexes,
                        measure: measure,
                        value: value,
                        isBold: !groupIntersectionId[0].length || !groupIntersectionId[1].length,
                    });
                });
                
                rows.push(row);
            } else {
                // Continue traversing the tree
                const keys = node.sortedKeys || [...node.directSubTrees.keys()];
                console.log("Traversing keys:", keys);
                keys.forEach(key => {
                    console.log("Processing key:", key);
                    const subTree = node.directSubTrees.get(key);
                    console.log("Subtree:", subTree);
                    flattenTree(subTree, {...currentRow});
                });
            }
        };
        
        flattenTree(tree);
        return rows;
    }
    
    _getSortedColumnsForRow(rowGroupValues, columns) {
        // Create a mapping of full column paths to column objects
        const columnMap = new Map();
        columns.forEach(column => {
            const key = JSON.stringify(column.groupId[1]); // Full column path
            columnMap.set(key, column);
        });
        
        // Get all leaf column paths in sorted order
        const sortedColumnPaths = this._getSortedColumnPaths();
        
        // Create sorted columns array
        return sortedColumnPaths.map(path => {
            return columnMap.get(JSON.stringify(path));
        }).filter(Boolean);
    }

    _getSortedColumnPaths() {
        const paths = [];
        const traverse = (node, currentPath = []) => {
            if (node.directSubTrees.size === 0) {
                // Leaf node: add the full path
                paths.push([...currentPath]);
            } else {
                // Use sortedKeys if available
                const keys = node.sortedKeys || [...node.directSubTrees.keys()];
                keys.forEach(key => {
                    const subTree = node.directSubTrees.get(key);
                    traverse(subTree, [...currentPath, key]);
                });
            }
        };
        traverse(this.data.colGroupTree);
        return paths;
    }
    /**
     * returns the height of a given groupTree
     *
     * @protected
     * @param {Object} tree, a groupTree
     * @returns {number}
     */
    _getTreeHeight(tree) {
        const subTreeHeights = [...tree.directSubTrees.values()].map(
            this._getTreeHeight.bind(this)
        );
        return Math.max(0, Math.max.apply(null, subTreeHeights)) + 1;
    }
    /**
     * @protected
     * @param {Data} data
     * @returns {boolean} true iff there's no data in the table
     */
    _hasData(data) {
        return (data.counts[JSON.stringify([[], []])] || []).some((count) => {
            return count > 0;
        });
    }
    /**
     * Initialize/Reinitialize data.rowGroupTree, colGroupTree, measurements,
     * counts and subdivide the group 'Total' as many times it is necessary.
     * A first subdivision with no groupBy (divisors.slice(0, 1)) is made in
     * order to see if there is data in the intersection of the group 'Total'
     * and the various origins. In case there is none, non supplementary rpc
     * will be done (see the code of subdivideGroup).
     *
     * @protected
     * @param {Config} config
     */
    async _loadData(config, prune = true) {
        config.data = {}; // data will be completely recomputed
        const { data, metaData } = config;
        data.rowGroupTree = { root: { labels: [], values: [] }, directSubTrees: new Map() };
        data.colGroupTree = { root: { labels: [], values: [] }, directSubTrees: new Map() };
        data.measurements = {};
        data.counts = {};
        data.groupDomains = {};
        data.numbering = {};
        const key = JSON.stringify([[], []]);
        data.groupDomains[key] = metaData.domains.slice(0);

        const group = { rowValues: [], colValues: [] };
        const leftDivisors = sections(metaData.fullRowGroupBys);
        const rightDivisors = sections(metaData.fullColGroupBys);
        const divisors = cartesian(leftDivisors, rightDivisors);

        await this._subdivideGroup(group, divisors.slice(0, 1), config);
        await this._subdivideGroup(group, divisors.slice(1), config);

        // keep folded groups folded after the reload if the structure of the table is the same
        if (prune && this._hasData(data) && this._hasData(this.data)) {
            if (
                symmetricalDifference(metaData.rowGroupBys, this.metaData.rowGroupBys).length === 0
            ) {
                this._pruneTree(data.rowGroupTree, this.data.rowGroupTree);
            }
            if (
                symmetricalDifference(metaData.colGroupBys, this.metaData.colGroupBys).length === 0
            ) {
                this._pruneTree(data.colGroupTree, this.data.colGroupTree);
            }
        }

        this.data = config.data;
        this.metaData = config.metaData;
    }
    /**
     * @protected
     * @param {string} gb
     * @returns {string}
     */
    _normalize(gb) {
        const [fieldName, interval] = gb.split(":");
        const field = this.metaData.fields[fieldName];
        if (["date", "datetime"].includes(field.type)) {
            return `${fieldName}:${interval || "day"}`;
        } else {
            return fieldName;
        }
    }
    /**
     * Extract the information in the read_group results (groupSubdivisions)
     * and develop this.data.rowGroupTree, colGroupTree, measurements, counts, and
     * groupDomains.
     * If a column needs to be sorted, the rowGroupTree corresponding to the
     * group is sorted.
     *
     * @protected
     * @param {Object} group
     * @param {Object[]} groupSubdivisions
     * @param {Config} config
     */
    async _prepareData(group, groupSubdivisions, config) {
        const { data, metaData } = config;
        const groupRowValues = group.rowValues;
        let groupRowLabels = [];
        let rowSubTree = data.rowGroupTree;
        let root;
        if (groupRowValues.length) {
            // we should have labels information on hand! regretful!
            rowSubTree = this._findGroup(data.rowGroupTree, groupRowValues);
            root = rowSubTree.root;
            groupRowLabels = root.labels;
        }

        const groupColValues = group.colValues;
        let groupColLabels = [];
        if (groupColValues.length) {
            root = this._findGroup(data.colGroupTree, groupColValues).root;
            groupColLabels = root.labels;
        }

        //groupSubdivisions.forEach((groupSubdivision) => {
        //    groupSubdivision.subGroups.forEach((subGroup) => {
        for (const groupSubdivision of groupSubdivisions) {
            for (const subGroup of groupSubdivision.subGroups) {
                const rowValues = groupRowValues.concat(
                    this._getGroupValues(subGroup, groupSubdivision.rowGroupBy)
                );
                const rowLabels = groupRowLabels.concat(
                    this._getGroupLabels(subGroup, groupSubdivision.rowGroupBy, config)
                );
                const colValues = groupColValues.concat(
                    this._getGroupValues(subGroup, groupSubdivision.colGroupBy)
                );
                const colLabels = groupColLabels.concat(
                    this._getGroupLabels(subGroup, groupSubdivision.colGroupBy, config)
                );

                if (!colValues.length && rowValues.length) {
                    this._addGroup(data.rowGroupTree, rowLabels, rowValues);
                }
                if (colValues.length && !rowValues.length) {
                    this._addGroup(data.colGroupTree, colLabels, colValues);
                }
                const key = JSON.stringify([rowValues, colValues]);
                groupSubdivision.group.rowValues = rowValues;
                groupSubdivision.group.rowLabels = rowLabels;
                groupSubdivision.group.colValues = colValues;
                groupSubdivision.group.colLabels = colLabels;
                const originIndex = groupSubdivision.group.originIndex;

                if (!(key in data.measurements)) {
                    data.measurements[key] = metaData.origins.map(() => {
                        return this._getMeasurements({}, config);
                    });
                }
                data.measurements[key][originIndex] = this._getMeasurements(subGroup, config);

                if (!(key in data.counts)) {
                    data.counts[key] = metaData.origins.map(function () {
                        return 0;
                    });
                }
                data.counts[key][originIndex] = subGroup.__count;

                if (!(key in data.groupDomains)) {
                    data.groupDomains[key] = metaData.origins.map(function () {
                        return Domain.FALSE.toList();
                    });
                }
                // if __domain is not defined this means that we are in the
                // case where
                // groupSubdivision.rowGroupBy = groupSubdivision.rowGroupBy = []
                if (subGroup.__domain) {
                    data.groupDomains[key][originIndex] = subGroup.__domain;
                }
            }
        }
        if (metaData.sortedColumn) {
            this._sortRows(metaData.sortedColumn, config);
        }
        console.log("data",config.data);
        if (config.data && config.data.colGroupTree) {
            await this._sortColumnTree(config.data.colGroupTree, config);
            console.log("data",config.data);
            //config.data.colGroupTree.sortedKeys = sortedKeys;
        }
        //await this._sortColumnTree(data.colGroupTree, metaData.colGroupBys, config);
    }
    async _sortColumnTree(tree, config) {
        if (!tree.directSubTrees.size) return;
        
        const level = tree.root.values.length;
        const groupBy = config.metaData.fullColGroupBys[level];
        
        if (groupBy) {
            const [fieldName] = groupBy.split(':');
            const field = config.metaData.fields[fieldName];
            const fieldAttrs = config.metaData.fieldAttrs[fieldName];
            
            if (field && field.type === 'many2one') {
                const keys = [...tree.directSubTrees.keys()];
                //tree.sortedKeys = await this._sortIdsByModelOrder(keys, field.relation,fieldAttrs?.order);
                tree.sortedKeys = keys;
            }
        }
        
        // Process children in sorted order
        const keys = tree.sortedKeys || [...tree.directSubTrees.keys()];
        for (const key of keys) {
            const subTree = tree.directSubTrees.get(key);
            await this._sortColumnTree(subTree, config);
        }
}
    /**
     * Make any group in tree a leaf if it was a leaf in oldTree.
     *
     * @protected
     * @param {Object} tree
     * @param {Object} oldTree
     */
    _pruneTree(tree, oldTree) {
        if (!oldTree.directSubTrees.size) {
            tree.directSubTrees.clear();
            delete tree.sortedKeys;
            return;
        }
        [...tree.directSubTrees.keys()].forEach((subTreeKey) => {
            const subTree = tree.directSubTrees.get(subTreeKey);
            if (!oldTree.directSubTrees.has(subTreeKey)) {
                subTree.directSubTrees.clear();
                delete subTree.sortedKeys;
            } else {
                const oldSubTree = oldTree.directSubTrees.get(subTreeKey);
                this._pruneTree(subTree, oldSubTree);
            }
        });
    }

    _getEmptyGroupLabel(fieldName) {
        return _t("");
    }

    /**
     * Extract from a groupBy value a label.
     *
     * @protected
     * @param {any} value
     * @param {string} groupBy
     * @param {Config} config
     * @returns {string}
     */
    _sanitizeLabel(value, groupBy, config) {
        const { metaData } = config;
        const fieldName = groupBy.split(":")[0];
        if (
            fieldName &&
            metaData.fields[fieldName] &&
            metaData.fields[fieldName].type === "boolean"
        ) {
            return value === undefined ? _t("None") : value ? _t("Yes") : _t("No");
        }
        if (value === false) {
            return this._getEmptyGroupLabel(fieldName);
        }
        if (value instanceof Array) {
            return this._getNumberedLabel(value, fieldName, config);
        }
        if (
            fieldName &&
            metaData.fields[fieldName] &&
            metaData.fields[fieldName].type === "selection"
        ) {
            const selected = metaData.fields[fieldName].selection.find((o) => o[0] === value);
            return selected ? selected[1] : value; // selected should be truthy normally ?!
        }
        if (
            fieldName &&
            metaData.fields[fieldName] &&
            ["date", "datetime"].includes(metaData.fields[fieldName].type)
        ){
            value =this.formatDateModel(value,metaData.fields[fieldName].type)
        }
        return value;
    }
    /**
     * Extract from a groupBy value the raw value of that groupBy (discarding
     * a label if any)
     *
     * @protected
     * @param {any} value
     * @returns {any}
     */
    _sanitizeValue(value) {
        if (value instanceof Array) {
            return value[0];
        }
        return value;
    }
    /**
     * Get all partitions of a given group using the provided list of divisors
     * and enrich the objects of this.data.rowGroupTree, colGroupTree,
     * measurements, counts.
     *
     * @protected
     * @param {Object} group
     * @param {Array[]} divisors
     * @param {Config} config
     */
    async _subdivideGroup(group, divisors, config) {
        const { data, metaData } = config;
        const key = JSON.stringify([group.rowValues, group.colValues]);
        console.log("subdivideGroup", key, group.rowValues, group.colValues, divisors);
        const proms = metaData.origins.reduce((acc, origin, originIndex) => {
            // if no information on group content is available, we fetch data.
            // if group is known to be empty for the given origin,
            // we don't need to fetch data for that origin.
            if (!data.counts[key] || data.counts[key][originIndex] > 0) {
                const subGroup = {
                    rowValues: group.rowValues,
                    colValues: group.colValues,
                    originIndex: originIndex,
                };
                divisors.forEach((divisor) => {
                    acc.push(this._getGroupSubdivision(subGroup, divisor[0], divisor[1], config));
                });
            }
            return acc;
        }, []);
        const groupSubdivisions = await this.keepLast.add(Promise.all(proms));
        if (groupSubdivisions.length) {
            await this._prepareData(group, groupSubdivisions, config);
        }
    }
    /**
     * Sort the rows, depending on the values of a given column.  This is an
     * in-memory sort.
     *
     * @protected
     * @param {Object} sortedColumn
     * @param {number[]} sortedColumn.groupId
     * @param {Config} config
     */
    _sortRows(sortedColumn, config) {
        const metaData = config.metaData || this.metaData;
        const data = config.data || this.data;
        const colGroupValues = sortedColumn.groupId[1];
        sortedColumn.originIndexes = sortedColumn.originIndexes || [0];
        metaData.sortedColumn = sortedColumn;

        const sortFunction = (tree) => {
            return (subTreeKey) => {
                const subTree = tree.directSubTrees.get(subTreeKey);
                const groupIntersectionId = [subTree.root.values, colGroupValues];
                const value =
                    this._getCellValue(
                        groupIntersectionId,
                        sortedColumn.measure,
                        sortedColumn.originIndexes,
                        { data }
                    ) || 0;
                return sortedColumn.order === "asc" ? value : -value;
            };
        };

        this._sortTree(sortFunction, data.rowGroupTree);
    }
    /**
     * Sort recursively the subTrees of tree using sortFunction.
     * In the end each node of the tree has its direct children sorted
     * according to the criterion reprensented by sortFunction.
     *
     * @protected
     * @param {Function} sortFunction
     * @param {Object} tree
     */
    _sortTree(sortFunction, tree) {
        tree.sortedKeys = sortBy([...tree.directSubTrees.keys()], sortFunction(tree));
        [...tree.directSubTrees.values()].forEach((subTree) => {
            this._sortTree(sortFunction, subTree);
        });
    }
    // Add this method to fetch model ordering
    async _getModelOrder(model) {
        try {
            //return await this.orm.call(model, 'get_order', []);
            const rpc = useService("rpc");
            const result = await rpc("/web/dataset/call_kw", {
                model: "ir.model",
                method: "search_read",
                args: [[["model", "=", model]], ["model", "name", "order"]],
            });
            console.log(`Model order for ${model}:`, result);
            return result.length > 0 ? result[0].order : null;
        } catch (e) {
            console.error(`Error fetching order for ${model}:`, e);
            return null;
        }
    }

    async _sortIdsByModelOrder(ids, model,order) {
        if (!ids.length) return ids;
        console.log("Sorting IDs by model order:", ids, model);
        try {
            // Use fixed order instead of dynamic lookup
            const sortedIds= await this.orm.searchRead(
                model,
                [['id', 'in', ids]],
                ['id'],
                { order: order?order:await this._getModelOrder(model) }
            ).then(records => records.map(record => record.id));
            console.log("Sorted IDs:", sortedIds);  
            return sortedIds
        } catch (e) {
            console.error("Sorting failed, using natural order", e);
            return ids;
        }
    }
// // Update the _getGroupSubdivision method
// async _getGroupSubdivision(group, rowGroupBy, colGroupBy, config) {
//     const groupDomain = this._getGroupDomain(group, config);
//     const measureSpecs = this._getMeasureSpecs(config);
//     const groupBy = this._getGroupBySpecs(rowGroupBy, colGroupBy);
    
//     // Get the order for the first many2one field in groupBy
//     let orderBy = null;
//     for (const gb of groupBy) {
//         const [fieldName] = gb.split(':');
//         const field = this.metaData.fields[fieldName];
//         if (field && field.type === 'many2one') {
//             if (!this.modelOrderCache) {
//                 this.modelOrderCache = new Map();
//             }
//             if (!this.modelOrderCache.has(field.relation)) {
//                 const order = await this._getModelOrder(field.relation);
//                 this.modelOrderCache.set(field.relation, order);
//             }
//             orderBy = this.modelOrderCache.get(field.relation);
//             break;
//         }
//     }

//     const kwargs = {
//         lazy: false,
//         context: this.searchParams.context,
//         orderby: orderBy
//     };
    
//     const subGroups = await this.orm.readGroup(
//         config.metaData.resModel,
//         groupDomain,
//         measureSpecs,
//         groupBy,
//         kwargs
//     );
    
//     return {
//         group: group,
//         subGroups: subGroups,
//         rowGroupBy: rowGroupBy,
//         colGroupBy: colGroupBy
//     };
// }

// // Update the _sortTree method
// async _sortTree(sortFunction, tree) {
//     // Get the current group by field
//     const groupBys = this.metaData.fullRowGroupBys.concat(this.metaData.fullColGroupBys);
//     if (tree.root.values.length > 0 && groupBys.length >= tree.root.values.length) {
//         const groupBy = groupBys[tree.root.values.length - 1];
//         const [fieldName] = groupBy.split(':');
//         const field = this.metaData.fields[fieldName];
        
//         // Handle many2one fields
//         if (field && field.type === 'many2one') {
//             // Get the order from cache or fetch it
//             if (!this.modelOrderCache) {
//                 this.modelOrderCache = new Map();
//             }
//             if (!this.modelOrderCache.has(field.relation)) {
//                 const order = await this._getModelOrder(field.relation);
//                 this.modelOrderCache.set(field.relation, order);
//             }
//             const order = this.modelOrderCache.get(field.relation);
//             console.log(`Sorting by ${fieldName} with order:`, order);
//             if (order) {
//                 // Sort according to the model's order
//                 const keys = [...tree.directSubTrees.keys()];
//                 const orderedValues = await this._getOrderedMany2OneValues(fieldName, keys, order);
//                 tree.sortedKeys = orderedValues;
                
//                 // Continue sorting subtrees
//                 tree.sortedKeys.forEach((key) => {
//                     const subTree = tree.directSubTrees.get(key);
//                     this._sortTree(sortFunction, subTree);
//                 });
//                 return;
//             }
//         }
//     }
    
//     // Default sorting
//     tree.sortedKeys = sortBy([...tree.directSubTrees.keys()], sortFunction(tree));
//     tree.sortedKeys.forEach((key) => {
//         const subTree = tree.directSubTrees.get(key);
//         this._sortTree(sortFunction, subTree);
//     });
// }

// // Add helper method to sort many2one values
// async _getOrderedMany2OneValues(fieldName, values, order) {
//     const field = this.metaData.fields[fieldName];
//     const ids = values.map(v => v[0]); // Extract IDs
    
//     // Search records with the model's order
//     const records = await this.orm.searchRead(
//         field.relation,
//         [['id', 'in', ids]],
//         ['id'],
//         { order: order }
//     );
    
//     // Map IDs to their position in the ordered list
//     const idToOrder = {};
//     records.forEach((record, index) => {
//         idToOrder[record.id] = index;
//     });
    
//     // Sort values based on their position in ordered list
//     return values.sort((a, b) => {
//         const aOrder = idToOrder[a[0]] || Infinity;
//         const bOrder = idToOrder[b[0]] || Infinity;
//         return aOrder - bOrder;
//     });
// }
}
