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
import { Domain } from "@web/core/domain";
import { session } from "@web/session";
const companyId = session.user_context.company_id;

const formatters = registry.category("formatters");

function updateSelection($items, index) {
    $items.removeClass("active");
    const $selected = $items.eq(index);
    $selected.addClass("active");
    $selected[0]?.scrollIntoView({ block: "nearest" });
}

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
        this._m2oOptions = [];
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".o_input_dropdown")) {
                $(".o-autocomplete--dropdown-menu").remove();
            }
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
    formatDate(value, fieldType) {
        if (!value) {
            return "";
        }
        const formattedDate = new Date(value);
        const pad = (n) => String(n).padStart(2, '0');
        if (fieldType === 'datetime') {
            //return formattedDate.toISOString().slice(0, 19).replace('T', ' ');
            return `${formattedDate.getFullYear()}-${pad(formattedDate.getMonth() + 1)}-${pad(formattedDate.getDate())} ${pad(formattedDate.getHours())}:${pad(formattedDate.getMinutes())}:${pad(formattedDate.getSeconds())}`;
        }
        else {
            //return formattedDate.toISOString().split('T')[0];
            return `${formattedDate.getFullYear()}-${pad(formattedDate.getMonth() + 1)}-${pad(formattedDate.getDate())}`;
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
    /**
     * Get the field type for a measure
     * @param {string} measureName
     * @returns {string}
     */
    getFieldType(measureName) {
        const field = this.model.metaData.fields[measureName];
        return field ? field.type : 'char';
    }

    /**
     * Get selection options for a field
     * @param {string} measureName
     * @returns {Array[]}
     */
    getSelectionOptions(measureName) {
        const field = this.model.metaData.fields[measureName];
        return field.selection || [];
    }

    /**
     * Fetch many2one options
     * @param {string} fieldName
     */
    async getMany2OneOptions(fieldName) {
        const field = this.model.metaData.fields[fieldName];
        if (field.type === "many2one") {
            const model = field.relation;
            let domain = [];
            const pattern = "(company_id and ['|', ('company_id', '=', False), ('company_id', 'parent_of', [company_id])] or ['|', ('company_id', '=', False), ('company_id', 'parent_of', [''])])";
            if (field.domain) {
                // Replace the pattern with the actual company_id
                var fieldDomain=JSON.stringify(field.domain);
                if (fieldDomain.includes(pattern)) {
                    domain = companyId
                                ? ['|', ['company_id', '=', false], ['company_id', 'parent_of', companyId]]
                                : ['|', ['company_id', '=', false], ['company_id', 'parent_of', '']];
                    /*try {
                    
                        var splitedDomain=fieldDomain.split('+');
                        
                        if (splitedDomain.length > 1) {
                            var additionalDomain=new Domain(eval(splitedDomain[1].trim())).toList();
                            domain=[...companyDomain, ...additionalDomain];
                        }
                    
                    
                    } catch (error) {
                        console.error("Invalid domain:", field.domain, error);
                        domain=[]
                    }*/
                }
                else{
                    domain=new Domain(field.domain).toList();
                }
            }
            
            const records = await this.orm.searchRead(model, domain, ["display_name"]);
            return records;
        }
        return [];
    }
    async displayMany2oneRecord(ev, fieldName,row_id,row) {
        // Remove any existing dropdown first
        $(".o-autocomplete--dropdown-menu").remove();   
        const options = await this.getMany2OneOptions(fieldName);
        this._m2oOptions = options;
        // The clicked .o_input_dropdown div
        const dropdownEl = "#div_"+row_id+"_"+fieldName;
        //setTimeout(() => {
        const $input = $(dropdownEl).find("input.o-autocomplete--input");

        /*if (!$input.length) {
            console.warn("Input not found inside .o_input_dropdown");
            return;
        }*/
        
        const offset = $input.offset();
        const inputHeight = $input.outerHeight();
    
        
        const $menu = $('<ul>', {
            class: "o-autocomplete--dropdown-menu ui-widget show dropdown-menu ui-autocomplete",
            css: {
                position: "fixed",
                top: offset.top + inputHeight,
                left: offset.left,
                "z-index": 1000,
            },
            id: "dropdown-menu_"+row_id+"_"+fieldName,
        });
        const self = this;
        options.forEach(opt => {
            const $item = $('<li>', {
                class: "o-autocomplete--dropdown-item ui-menu-item d-block"
            }).append(
                $('<a>', {
                    href: "#",
                    class: "dropdown-item ui-menu-item-wrapper text-truncate",
                    text: opt.display_name,
                    click: (e) => {
                        e.preventDefault();
                        
                        //this.row.data[fieldName] = opt.id;
                        console.log("Selected Many2oneRecord self.row",self.row,this.row);
                        //alert("Selected Many2oneRecord: "+ opt.id + '-'+ opt.display_name);
                        //self.row.data[fieldName] = { id: opt.id, label: opt.display_name };
                        self._selectMany2OneOption(opt, fieldName,$menu, dropdownEl,row);
                        self.render();
                    }
                })
            );
            $menu.append($item);
        });
    
        // Optional "Search More"
        /*$menu.append(
            $('<li>', { class: "o-autocomplete--dropdown-item ui-menu-item d-block o_m2o_dropdown_option o_m2o_dropdown_option_search_more" })
                .append(
                    $('<a>', {
                        href: "#",
                        class: "dropdown-item ui-menu-item-wrapper text-truncate",
                        text: "Search More...",
                        click: (e) => {
                            e.preventDefault();
                            alert("Open search modal (to be implemented)");
                        }
                    })
                )
        );*/
    
        $("body").append($menu);
        /*$input.off("keyup.m2o").on("keyup.m2o", (e) => {
            const query = e.target.value.toLowerCase().trim();
            this._filterMany2OneOptions(query, fieldName, $menu,dropdownEl,row);
        });*/
        /*$input.addEventListener("keyup", (e) => {
            const query = e.target.value.toLowerCase().trim();
            this._filterMany2OneOptions(query, fieldName, $(dropdownEl));
        });*/
        //},1000);
        let selectedIndex = -1;
        $input.off("keydown.m2o").on("keydown.m2o", function (e) {
            const menuItems = $('#dropdown-menu_'+row_id+'_'+fieldName).find("li.o-autocomplete--dropdown-item");
            const total = menuItems.length;
            //if (!total) return;
            // If the menu is not open, do nothing
            if (!$menu.is(":visible")) {
                 $("body").append($menu);
            }
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    
                    selectedIndex = (selectedIndex + 1) % total;
                    updateSelection(menuItems, selectedIndex);
                    break;

                case "ArrowUp":
                    e.preventDefault();
                    selectedIndex = (selectedIndex - 1 + total) % total;
                    updateSelection(menuItems, selectedIndex);
                    break;

                case "Enter":
                    e.preventDefault();
                    if (selectedIndex >= 0 && selectedIndex < total) {
                        $(menuItems[selectedIndex]).find("a")[0].click();
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    $menu.remove();
                    break;
                default:
                    // Handle other keys if needed
                    const query = e.target.value.toLowerCase().trim();
                    self._filterMany2OneOptions(query, fieldName, $menu,dropdownEl,row);
                    break;

            }
        });
        
        
    }
    
    _filterMany2OneOptions(query, fieldName, $menu,dropdownEl,row) {
        //alert("_filterMany2OneOptions")
        const filtered = this._m2oOptions.filter(opt =>
            opt.display_name.toLowerCase().includes(query)
        );
        const self = this;
        const $menu_displayed = $(".o-autocomplete--dropdown-menu");
        $menu.empty();  // Clear old items
    
        filtered.forEach(opt => {
            const $item = $('<li>', {
                class: "o-autocomplete--dropdown-item ui-menu-item d-block"
            }).append(
                $('<a>', {
                    href: "#",
                    class: "dropdown-item ui-menu-item-wrapper text-truncate",
                    html: this._highlightMatch(opt.display_name, query),
                    click: (e) => {
                        e.preventDefault();
                        console.log("Selected Many2OneOption self.row",self.row,this.row);
                        //alert("Selected Many2OneOption: "+ opt.id + '-'+ opt.display_name);
                        //self.row.data[fieldName] = { id: opt.id, label: opt.display_name };
                        self._selectMany2OneOption(opt, fieldName,$menu, dropdownEl,row);
                        self.render();
                    },
                    
                })
            );
            $menu.append($item);
        });
    
        // If no results, show "No match"
        if (!filtered.length) {
            $menu.append(
                $('<li>', {
                    class: "o-autocomplete--dropdown-item ui-menu-item d-block text-muted px-3",
                    text: "No matching results"
                })
            );
        }
    
        // Always add Search More
        /*$menu.append(
            $('<li>', { class: "o-autocomplete--dropdown-item ui-menu-item d-block o_m2o_dropdown_option o_m2o_dropdown_option_search_more" })
                .append(
                    $('<a>', {
                        href: "#",
                        class: "dropdown-item ui-menu-item-wrapper text-truncate",
                        text: "Search More...",
                        click: (e) => {
                            e.preventDefault();
                            alert("Open search modal (to be implemented)");
                        }
                    })
                )
        );*/
        if ($menu_displayed.length<=0) {
            // Append the menu to the body
           $("body").append($menu);
        }
    }
    _selectMany2OneOption(option, fieldName,$menu,dropdownEl,row) {
        console.log("Selected Many2OneOption", option);
        console.log(dropdownEl)
        const input = $(dropdownEl).find("input.o-autocomplete--input");
        console.log(input)
        if (!input) {
            console.warn("Input not found inside .o_input_dropdown");
            return;
        }
        // Set the value of the input to the selected option 
        input.val(option.display_name);
        input.closest('td').attr('data-tooltip', option.display_name);
        // Set the value of the row data to the selected option
        row.data[fieldName] = { id: option.id, label: option.display_name };
        // Remove the dropdown menu
        $menu.remove();
        
    
    }
    _highlightMatch(name, query) {
        const escapedName = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const index = escapedName.toLowerCase().indexOf(query);
        if (index === -1) return escapedName;
    
        const before = escapedName.slice(0, index);
        const match = escapedName.slice(index, index + query.length);
        const after = escapedName.slice(index + query.length);
    
        return `${before}<strong>${match}</strong>${after}`;
    }
    
    //Edit Button to make the matrix cells editable and show the Save and Cancel Buttons
    onEditButtonClicked(){
        const edits = {};
        this.table.rows.forEach(row => {
            edits[row.id] = {};
            this.model.metaData.rowGroupBys.forEach(field => {
                const fieldName = field.split(':')[0];
                edits[row.id][fieldName] = row.data[fieldName]?.value;
            });
        });
        this.state.edits = edits;
        this.state.isEditing = true;
        $('.o_matrix_edit').hide();
        $('.o_matrix_download').hide();
        $('.o_matrix_save').show();
        $('.o_matrix_cancel').show();
        const firstInput = $('.edit_mode').first();
        if (firstInput) {
            firstInput.focus();
        }
    }
    onFieldEdit(rowId, fieldName, value) {
        /*if (!this.state.edits[rowId]) {
            this.state.edits[rowId] = {};
        }
        this.state.edits[rowId][fieldName] = value;*/
    }
    
    //Save Button to save the modified datas and render the readonly mode
    /*async onSaveButtonClicked() {
        const updates = [];
        for (const [rowId, changes] of Object.entries(this.state.edits)) {
            const validChanges = {};
            for (const [field, value] of Object.entries(changes)) {
                const fieldType = this.getFieldType(field);
                // Basic validation
                if (['float', 'integer'].includes(fieldType) && isNaN(value)) {
                    this.notification.add(_t("Invalid number for field ") + field, { type: "danger" });
                    return;
                }
                validChanges[field] = value;
            }
            updates.push({ id: parseInt(rowId, 10), changes: validChanges });
        }
        try {
            await this.orm.write(
                this.model.metaData.resModel,
                updates.map(u => u.id),
                updates.map(u => u.changes)
            );
            this.notification.add(_t("Changes saved successfully"), { type: "success" });
            this.state.isEditing = false;
            this.state.edits = {};
            this.model.load(this.model.searchParams); // Refresh data
        } catch (error) {
            this.notification.add(_t("Error saving changes"), { type: "danger" });
            console.error(error);
        }
    }*/
    
    async onSaveButtonClicked() {
        try {
            const creates = [];
            const updates = [];

            // Process new rows
            this.model.data.newRows?.forEach(newRow => {
                if (this.state.edits[newRow.id]) {
                    creates.push(this.state.edits[newRow.id]);
                }
            });

            // Process existing rows
            for (const [rowId, changes] of Object.entries(this.state.edits)) {
                if (!rowId.startsWith('new_')) {
                    updates.push({
                        id: parseInt(rowId, 10),
                        changes
                    });
                }
            }

            // Execute writes
            if (creates.length) {
                await this.orm.create(this.model.metaData.resModel, creates);
            }
            if (updates.length) {
                await this.orm.write(
                    this.model.metaData.resModel,
                    updates.map(u => u.id),
                    updates.map(u => u.changes)
                );
            }

            // Reset state
            this.model.data.newRows = [];
            this.state.isEditing = false;
            this.state.edits = {};
            this.model.load(this.model.searchParams);
            
            this.notification.add(_t("Changes saved successfully"), { type: "success" });
        } catch (error) {
            this.notification.add(_t("Error saving changes"), { type: "danger" });
            console.error("Save error:", error);
        }
    }
    //Cancel Button to cancel the ongoing modifications and render the readonly mode
    onCancelButtonClicked(){
        $('.o_matrix_edit').show();
        $('.o_matrix_download').show();
        $('.o_matrix_save').hide();
        $('.o_matrix_cancel').hide();
        
        // Reset model state
        this.model.data.newRows = [];
        this.model.load(this.model.searchParams);
        
        // Reset UI state
        this.state.isEditing = false;
        this.state.edits = {};
        
        // Force full reload
        this.model.notify();
    }


    onAddLineClicked() {
        this.model.addLine();
        this.state.edits = this.state.edits || {};
        const newRowId = this.model.data.newRows[0]?.id;
        if (newRowId) {
            this.state.edits[newRowId] = {};
            this.model.metaData.rowGroupBys.forEach(field => {
                const fieldName = field.split(':')[0];
                this.state.edits[newRowId][fieldName] = null;
            });
        }
        this.render();
        const firstInput = $('.edit_mode').first();
        if (firstInput) {
            firstInput.focus();
        }
    }
    onAddColumnClicked() {
        alert("Add column");
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
        if (cell.value === undefined || this.model.metaData.disableLinking || this.state.isEditing) {
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

