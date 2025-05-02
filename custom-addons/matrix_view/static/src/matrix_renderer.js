/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { CheckBox } from "@web/core/checkbox/checkbox";
import { localization } from "@web/core/l10n/localization";
import { registry } from "@web/core/registry";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { formatPercentage } from "@web/views/fields/formatters";
import { MatrixGroupByMenu } from "./matrix_group_by_menu";

import { Component, onWillUpdateProps, useRef, useState } from "@odoo/owl";
import { download } from "@web/core/network/download";
import { useService } from "@web/core/utils/hooks";
const formatters = registry.category("formatters");

export class MatrixRenderer extends Component {
    setup() {
        this.actionService = useService("action");
        this.model = this.props.model;
        this.table = this.model.getTable() || { headers: [], rows: [] };
        this.l10n = localization;
        this.tableRef = useRef("table");
        this.orm = useService("orm");
        this.notification = useService("notification");
        onWillUpdateProps(() => {
            this.table = this.model.getTable() || { headers: [], rows: [] };
            this._cleanupTableStructure();
        });
        this.state = useState({
            edits: {},
            isEditing: false,
        });
    }
    
    _cleanupTableStructure() {
        if (!this.table || !this.table.headers) {
            this.table = { headers: [], rows: [] };
            return;
        }
        
        // Remove measure name rows if they exist
        this.table.headers = this.table.headers.filter(headerRow => 
            Array.isArray(headerRow) && !headerRow.some(cell => cell && cell.measure)
        );
        
        // Clean up column headers
        if (this.table.headers.length > 0) {
            const lastHeaderRow = this.table.headers[this.table.headers.length - 1];
            if (Array.isArray(lastHeaderRow)) {
                lastHeaderRow.forEach(cell => {
                    if (cell && cell.isLeaf) {
                        cell.title = cell.title || '';
                    }
                });
            }
        }
        
        // Remove empty rows and clean up data
        if (Array.isArray(this.table.rows)) {
            this.table.rows = this.table.rows.filter(row => 
                row && !(row.title === "Total" && row.indent === 0)
            );
        } else {
            this.table.rows = [];
        }
    }
    /**
     * Get the formatted value of the cell.
     *
     * @private
     * @param {Object} cell
     * @returns {string} Formatted value
     */
    getFormattedValue(cell) {
        const field = this.model.metaData.measures[cell.measure];
        let formatType = this.model.metaData.widgets[cell.measure];
        if (!formatType) {
            const fieldType = field.type;
            formatType = ["many2one", "reference"].includes(fieldType) ? "integer" : fieldType;
        }
        const formatter = formatters.get(formatType);
        return formatter(cell.value, field);
    }
    /**
     * Get the formatted variation of a cell.
     *
     * @private
     * @param {Object} cell
     * @returns {string} Formatted variation
     */
    getFormattedVariation(cell) {
        if (isNaN(cell.value)) {
            return "-";
        }
        return formatPercentage(cell.value, this.model.metaData.fields[cell.measure]);
    }
    /**
     * Retrieve the padding of a left header.
     *
     * @param {Object} cell
     * @returns {Number} Padding
     */
    getPadding(cell) {
        return 5 + cell.indent * 30;
        //return 0
    }

    //----------------------------------------------------------------------
    // Handlers
    //----------------------------------------------------------------------

    /**
     * Handle the adding of a custom groupby (inside the view, not the searchview).
     *
     * @param {"col"|"row"} type
     * @param {Array[]} groupId
     * @param {string} fieldName
     */
    onAddCustomGroupBy(type, groupId, fieldName) {
        this.model.addGroupBy({ groupId, fieldName, custom: true, type });
    }

    /**
     * Handle the selection of a groupby dropdown item.
     *
     * @param {"col"|"row"} type
     * @param {Object} payload
     */
    onGroupBySelected(type, payload) {
        this.model.addGroupBy({ ...payload, type });
    }
    /**
     * Handle a click on a header cell.
     *
     * @param {Object} cell
     * @param {string} type col or row
     */
    onHeaderClick(cell, type) {
        if (cell.isLeaf && cell.isFolded) {
            this.model.expandGroup(cell.groupId, type);
        } else if (!cell.isLeaf) {
            this.model.closeGroup(cell.groupId, type);
        }
    }
    /**
     * Handle a click on a measure cell.
     *
     * @param {Object} cell
     */
    onMeasureClick(cell) {
        this.model.sortRows({
            groupId: cell.groupId,
            measure: cell.measure,
            order: (cell.order || "desc") === "asc" ? "desc" : "asc",
            originIndexes: cell.originIndexes,
        });
    }
    /**
     * Hover the column in which the mouse is.
     *
     * @param {MouseEvent} ev
     */
    onMouseEnter(ev) {
        var index = [...ev.currentTarget.parentNode.children].indexOf(ev.currentTarget);
        if (ev.currentTarget.tagName === "TH") {
            if (
                !ev.currentTarget.classList.contains("o_matrix_origin_row") &&
                this.model.metaData.origins.length === 2
            ) {
                index = 3 * index; // two origins + comparison column
            }
            index += 1; // row groupbys column
        }
        this.tableRef.el
            .querySelectorAll("td:nth-child(" + (index + 1) + ")")
            .forEach((elt) => elt.classList.add("o_cell_hover"));
    }
    /**
     * Remove the hover on the columns.
     */
    onMouseLeave() {
        this.tableRef.el
            .querySelectorAll(".o_cell_hover")
            .forEach((elt) => elt.classList.remove("o_cell_hover"));
    }

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------
    //Edit Button to make the matrix cells editable and show the Save and Cancel Buttons
    onEditButtonClicked(){
        $('.o_matrix_edit').hide();
        $('.o_matrix_download').hide();
        $('.o_matrix_save').show();
        $('.o_matrix_cancel').show();
        this.state.isEditing = !this.state.isEditing;
        if (!this.state.isEditing) {
            this.state.edits = {};
        }
    }
    onFieldEdit(rowId, fieldName, value) {
        if (!this.state.edits[rowId]) {
            this.state.edits[rowId] = {};
        }
        this.state.edits[rowId][fieldName] = value;
    }
    //Save Button to save the modified datas and render the readonly mode
    async onSaveButtonClicked(){
        $('.o_matrix_edit').show();
        $('.o_matrix_download').show();
        $('.o_matrix_save').hide();
        $('.o_matrix_cancel').hide();
        try {
            const updates = [];
            for (const [rowId, changes] of Object.entries(this.state.edits)) {
                updates.push({
                    id: rowId,
                    changes,
                });
            }
            
            await this.orm.write(
                this.props.model.metaData.resModel,
                updates.map(u => u.id),
                updates.map(u => u.changes)
            );
            
            this.notification.add(_t("Changes saved successfully"), { type: "success" });
            this.state.isEditing = false;
            this.state.edits = {};
            this.props.model.load(this.props.model.searchParams); // Refresh data
        } catch (error) {
            this.notification.add(_t("Error saving changes"), { type: "danger" });
            console.error(error);
        }
    }
    //Cancel Button to cancel the ongoing modifications and render the readonly mode
    onCancelButtonClicked(){
        $('.o_matrix_edit').show();
        $('.o_matrix_download').show();
        $('.o_matrix_save').hide();
        $('.o_matrix_cancel').hide();
        this.state.isEditing = false;
        this.state.edits = {};
    }
    /**
     * Exports the current matrix table data in a xls file. For this, we have to
     * serialize the current state, then call the server /matrix_view/matrix/export_xlsx.
     * Force a reload before exporting to ensure to export up-to-date data.
     */
    onDownloadButtonClicked() {
        if (this.model.getTableWidth() > 16384) {
            throw new Error(
                _t(
                    "For Excel compatibility, data cannot be exported if there are more than 16384 columns.\n\nTip: try to flip axis, filter further or reduce the number of measures."
                )
            );
        }
        const table = this.model.exportData();
        download({
            url: "/matrix_view/matrix/export_xlsx",
            data: { data: new Blob([JSON.stringify(table)], { type: "application/json" }) },
        });
    }
    /**
     * Expands all groups
     */
    onExpandButtonClicked() {
        this.model.expandAll();
    }
    /**
     * Flips axis
     */
    onFlipButtonClicked() {
        this.model.flip();
    }
    /**
     * Toggles the given measure
     *
     * @param {Object} param0
     * @param {string} param0.measure
     */
    onMeasureSelected({ measure }) {
        this.model.toggleMeasure(measure);
    }
    /**
     * Execute the action to open the view on the current model.
     *
     * @param {Array} domain
     * @param {Array} views
     * @param {Object} context
     */
    openView(domain, views, context) {
        this.actionService.doAction({
            type: "ir.actions.act_window",
            name: this.model.metaData.title,
            res_model: this.model.metaData.resModel,
            views: views,
            view_mode: "list",
            target: "current",
            context,
            domain,
        });
    }
    /**
     * @param {CustomEvent} ev
     */
    onOpenView(cell) {
        if (cell.value === undefined || this.model.metaData.disableLinking) {
            return;
        }

        const context = Object.assign({}, this.model.searchParams.context);
        Object.keys(context).forEach((x) => {
            if (x === "group_by" || x.startsWith("search_default_")) {
                delete context[x];
            }
        });

        // retrieve form and list view ids from the action
        const { views = [] } = this.env.config;
        this.views = ["list", "form"].map((viewType) => {
            const view = views.find((view) => view[1] === viewType);
            return [view ? view[0] : false, viewType];
        });

        const group = {
            rowValues: cell.groupId[0],
            colValues: cell.groupId[1],
            originIndex: cell.originIndexes[0],
        };
        this.openView(this.model.getGroupDomain(group), this.views, context);
    }
   
}
MatrixRenderer.template = "matrix_view.MatrixRenderer";
MatrixRenderer.components = { Dropdown, DropdownItem, CheckBox, MatrixGroupByMenu };
MatrixRenderer.props = ["model", "buttonTemplate?"];
MatrixRenderer.defaultProps = {
    buttonTemplate: "matrix_view.MatrixView.Buttons",
};

