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
        this.rootRef = useRef("root");
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
            // if (field.domain) {
            //     // Replace the pattern with the actual company_id
            //     var fieldDomain=JSON.stringify(field.domain);
            //     if (fieldDomain.includes(pattern)) {
            //         domain = companyId
            //                     ? ['|', ['company_id', '=', false], ['company_id', 'parent_of', companyId]]
            //                     : ['|', ['company_id', '=', false], ['company_id', 'parent_of', '']];
            //         /*try {
                    
            //             var splitedDomain=fieldDomain.split('+');
                        
            //             if (splitedDomain.length > 1) {
            //                 var additionalDomain=new Domain(eval(splitedDomain[1].trim())).toList();
            //                 domain=[...companyDomain, ...additionalDomain];
            //             }
                    
                    
            //         } catch (error) {
            //             console.error("Invalid domain:", field.domain, error);
            //             domain=[]
            //         }*/
            //     }
            //     else{
            //         domain=new Domain(field.domain).toList();
            //     }
            // }
            
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
        const input = $(dropdownEl).find("input.o-autocomplete--input");
        if (!input) {
            console.warn("Input not found inside .o_input_dropdown");
            return;
        }
        // Set the value of the input to the selected option 
        input.val(option.display_name);
        input.attr('data-value', option.id);
        input.closest('td').attr('data-tooltip', option.display_name);
        // Set the value of the row data to the selected option
        if (row.data){
            (row.data)[fieldName] = { id: option.id, label: option.display_name };
        }
        row.edited = true;
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
            var rowgroupbys_length=this.model.metaData.rowGroupBys.length;
            var record_line=this.model.metaData.rowGroupBys[rowgroupbys_length-1];
            var record_line_id=row.data[record_line]?.value;
            edits[record_line_id] = {};
            this.model.metaData.rowGroupBys.forEach(field => {
                const fieldName = field.split(':')[0];
                edits[record_line_id][fieldName] = row.data[fieldName]?.value;
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
    onFieldEdit(fieldname_id,row,cell=null) {
        
        const input = $('#'+fieldname_id);
        const value = input.val();
        input.attr('data-value', value);
        console.log("fieldname_id",fieldname_id,row,cell);
        if (row.isNew){
            if (cell){
                cell.value=value
            }
            else {
                //row.value=value;
                let fieldName = fieldname_id.split('_')[0];
                row.data[fieldName].value=value;
            }
        }
        row.edited = true;
    }
    
    _getRecordIdsForRow(row) {
        const domain = [];
        
        // Build domain from row group values
        this.metaData.rowGroupBys.forEach(groupBy => {
            const fieldName = groupBy.split(':')[0];
            const value = row.data[fieldName]?.value;
            if (value !== undefined && value !== null) {
                domain.push([fieldName, '=', value]);
            }
        });

        if (domain.length === 0) return [];
        
        // Get matching record IDs
        return this.orm.search(this.metaData.resModel, domain, { limit: 1000 });
    }
    //Save Button to save the modified datas and render the readonly mode
    
    /*async _getRecordDataForCell(groupId,cell_field) {
        const domain = [];
        // Add row group filters
        this.model.metaData.rowGroupBys.forEach((groupBy, index) => {
            const fieldName = groupBy.split(':')[0];
            var value = groupId[0][index];
            const fieldInfo = this.model.metaData.fields[fieldName]
            if (fieldInfo && fieldInfo.type === 'date') {
                value = this.formatDate(value, 'date');
            }
            
            
            if (value) domain.push([fieldName, '=', value]);
        });
        
        
        // Add column group filters
        this.model.metaData.colGroupBys.forEach((groupBy, index) => {
            const fieldName = groupBy.split(':')[0];
            var value = groupId[1][index];
            const fieldInfo = this.model.metaData.fields[fieldName]
            if (fieldInfo && fieldInfo.type === 'date') {
                value = this.formatDate(value, 'date');
            }
            if (value) domain.push([fieldName, '=', value]);
        });
        
        
        if (domain.length === 0) return [];
        //return this.orm.search(this.model.metaData.resModel, domain, { limit: 1000 }).then((recordIds) => {return recordIds;});
        const allFields = [
            'id',cell_field,
            ...this.model.metaData.rowGroupBys.map(f => f.split(':')[0]),
            ...this.model.metaData.colGroupBys.map(f => f.split(':')[0]),
        ];

        const recordIds = await this.orm.search(this.model.metaData.resModel, domain, { limit: 1000 });
        if (!recordIds.length) return [];

        const records = await this.orm.read(this.model.metaData.resModel, recordIds, allFields);

        return records;
        
    }*/
    async _getRecordDataForCell(groupId, cell_field) {
        const domain = [];

        const formatGroup = (groupBys, groupValues) => {
            return groupBys.map((groupBy, index) => {
                const fieldName = groupBy.split(':')[0];
                let value = groupValues[index];
                const fieldInfo = this.model.metaData.fields[fieldName];
                if (fieldInfo && fieldInfo.type === 'date') {
                    value = this.formatDate(value, 'date');
                }
                return [fieldName, '=', value];
            });
        };

        domain.push(...formatGroup(this.model.metaData.rowGroupBys, groupId[0]));
        domain.push(...formatGroup(this.model.metaData.colGroupBys, groupId[1]));

        if (!domain.length) return [];

        const allFields = new Set([
            'id',
            cell_field,
            ...this.model.metaData.rowGroupBys.map(f => f.split(':')[0]),
            ...this.model.metaData.colGroupBys.map(f => f.split(':')[0]),
        ]);

        const records = await this.orm.searchRead(this.model.metaData.resModel, domain,[...allFields]);
        return records;
    }

    async onSaveButtonClicked() {
        const edits = {};
        const creates = [];
        const updates = [];
        let row_index = 0;

        for (const row of this.table.rows) {
            let cell_index = 0;
            console.log("row",row);
            console.log("row edited",row.edited);
            if (row.edited){
                for (const cell of row.subGroupMeasurements) {
                    if (! cell.value){
                        console.log("cell.value is null or undefined",cell,row);
                    }
                    const tocreate = {};
                    if (cell.groupId !== undefined && cell.groupId !== null) {
                        if (row.isNew){
                            const fieldName = cell.measure;
                            const new_value = $('#' + fieldName + '_' + row_index + '_' + cell_index).val();
                            if (new_value !== undefined && new_value !== null && new_value != 0){
                                tocreate[fieldName] = new_value;
                            }
                            var row_field_index=0
                            this.model.metaData.rowGroupBys.forEach(field => {
                                const fieldName = field.split(':')[0];
                                const fieldInfo = this.model.metaData.fields[fieldName];
                                var gbys_new_value = $('#' + fieldName + '_' + row_index).attr('data-value');
                                if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'datetime')) {
                                    gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                }
                                
                                tocreate[fieldName] = gbys_new_value;
                                row_field_index++;
                            });
                            var colfield_index=0
                            this.model.metaData.colGroupBys.forEach(colfield => {
                                const colfieldName = colfield.split(':')[0];
                                const colfieldInfo = this.model.metaData.fields[colfieldName];
                                var col_old_value = cell.groupId[1][colfield_index];
                                if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                                    col_old_value = this.formatDate(col_old_value, 'date');
                                }
                                
                                tocreate[colfieldName] = col_old_value;
                                colfield_index++;
                            });
                        }
                        else{
                            const records = await this._getRecordDataForCell(cell.groupId,cell.measure) || [];
                            const fieldName = cell.measure;
                            const value = cell.value;
                            const new_value = $('#' + fieldName + '_' + row_index + '_' + cell_index).val();
                            let new_value_updated = false;
                            if (records.length > 1) {
                                // Handle multiple records
                                for (const rec of records) {
                                    //rec=records[0]
                                    const record_line_id = rec.id;
                                    edits[record_line_id] = {};
                                    const rec_value=rec[cell.measure];
                                    if (new_value !== undefined && new_value !== null && new_value != 0 && new_value!=value) {
                                        /*if (new_value < value && !new_value_updated) {
                                            edits[record_line_id][fieldName] = rec_value-(value - new_value);
                                            new_value_updated = true;
                                        } else if (new_value > value && !new_value_updated) {
                                            tocreate[fieldName] = new_value - value;
                                            new_value_updated = true;
                                        }*/
                                        tocreate[fieldName] = new_value - value;
                                        new_value_updated = true;
                                    
                                    }
                                    this.model.metaData.rowGroupBys.forEach(field => {
                                        const fieldName = field.split(':')[0];
                                        var gbys_old_value = row.data[fieldName]?.value;
                                        var gbys_new_value = $('#' + fieldName + '_' + row_index).attr('data-value');
                                        const fieldInfo = this.model.metaData.fields[fieldName];
                                        if (gbys_old_value !== gbys_new_value && gbys_new_value !== undefined && gbys_new_value !== null) {
                                            if (fieldInfo && fieldInfo.type === 'date') {
                                                gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                                gbys_old_value = this.formatDate(gbys_old_value, 'date');
                                            }
                                            else if (fieldInfo && fieldInfo.type === 'many2one') {
                                                gbys_new_value = parseInt(gbys_new_value);
                                            }
                                            edits[record_line_id][fieldName] = gbys_new_value;
                                        }
                                        if (tocreate) {
                                            if (fieldInfo && fieldInfo.type === 'date') {
                                                gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                                gbys_old_value = this.formatDate(gbys_old_value, 'date');
                                            }
                                            else if (fieldInfo && fieldInfo.type === 'many2one') {
                                                gbys_new_value = parseInt(gbys_new_value);
                                            }
                                            const tocreate_value=gbys_new_value? gbys_new_value : gbys_old_value;
                                            tocreate[fieldName] = tocreate_value;
                                            this.model.metaData.colGroupBys.forEach(colfield => {
                                                const colfieldName = colfield.split(':')[0];
                                                const colfieldInfo = this.model.metaData.fields[colfieldName];
                                                var col_old_value = rec[colfieldName];
                                                if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                                                    col_old_value = this.formatDate(col_old_value, 'date');
                                                }
                                                else if (colfieldInfo.type === 'many2one') {
                                                    col_old_value = rec[colfieldName][0];
                                                }
                                                
                                                tocreate[colfieldName] = col_old_value;
                                            });
                                        }
                                    });
                                    if (edits[record_line_id] && Object.keys(edits[record_line_id]).length > 0){
                                        updates.push({
                                            id: parseInt(record_line_id, 10),
                                            changes: edits[record_line_id]
                                        });
                                    }
                                    
                                }
                            } 
                            else if (records.length === 1) {
                                // Handle single record
                                const record_line_id = records[0].id;
                                edits[record_line_id] = {};
                                if (new_value !== undefined && new_value !== null && new_value != 0 && new_value!=value) {
                                    edits[record_line_id][fieldName] = new_value;
                                    new_value_updated = true;
                                }

                                this.model.metaData.rowGroupBys.forEach(field => {
                                    const fieldName = field.split(':')[0];
                                    var gbys_old_value = row.data[fieldName]?.value;
                                    var gbys_new_value = $('#' + fieldName + '_' + row_index).attr('data-value');
                                    console.log("gbys_new_value",gbys_new_value);
                                    console.log("gbys_old_value",gbys_old_value);
                                    const fieldInfo = this.model.metaData.fields[fieldName];
                                    if (gbys_old_value !== gbys_new_value && gbys_new_value !== undefined && gbys_new_value !== null) {
                                        if (fieldInfo && fieldInfo.type === 'date') {
                                            gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                            gbys_old_value = this.formatDate(gbys_old_value, 'date');
                                        }
                                        else if (fieldInfo && fieldInfo.type === 'many2one') {
                                            gbys_new_value = parseInt(gbys_new_value);
                                        }
                                        edits[record_line_id][fieldName] = gbys_new_value;
                                    }
                                    if (tocreate) {
                                        if (fieldInfo && fieldInfo.type === 'date') {
                                            gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                            gbys_old_value = this.formatDate(gbys_old_value, 'date');
                                        }
                                        else if (fieldInfo && fieldInfo.type === 'many2one') {
                                            gbys_new_value = parseInt(gbys_new_value);
                                        }
                                        const tocreate_value=gbys_new_value? gbys_new_value : gbys_old_value;

                                        this.model.metaData.colGroupBys.forEach(colfield => {
                                            const colfieldName = colfield.split(':')[0];
                                            const colfieldInfo = this.model.metaData.fields[colfieldName];
                                            var col_old_value = records[0][colfieldName];
                                            if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                                                col_old_value = this.formatDate(col_old_value, 'date');
                                            }
                                            else if (colfieldInfo.type === 'many2one') {
                                                col_old_value = records[0][colfieldName][0];
                                            }
                                            tocreate[colfieldName] = col_old_value;
                                        });
                                        
                                    }
                                });
                                if (edits[record_line_id] && edits[record_line_id]!={}){
                                    updates.push({
                                        id: parseInt(record_line_id, 10),
                                        changes: edits[record_line_id]
                                    });
                                }
                            }
                            else if (new_value !== undefined && new_value !== null && new_value != 0 && new_value != '') {
                                // Handle new record
                                tocreate[fieldName] = new_value;
                                
                                var row_field_index=0
                                this.model.metaData.rowGroupBys.forEach(field => {
                                    const fieldName = field.split(':')[0];
                                    const fieldInfo = this.model.metaData.fields[fieldName];
                                    var gbys_new_value = cell.groupId[0][row_field_index];
                                    if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'datetime')) {
                                        gbys_new_value = this.formatDate(gbys_new_value, 'date');
                                    }
                                    
                                    tocreate[fieldName] = gbys_new_value;
                                    row_field_index++;
                                });
                                var colfield_index=0
                                this.model.metaData.colGroupBys.forEach(colfield => {
                                    const colfieldName = colfield.split(':')[0];
                                    const colfieldInfo = this.model.metaData.fields[colfieldName];
                                    var col_old_value = cell.groupId[1][colfield_index];
                                    if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                                        col_old_value = this.formatDate(col_old_value, 'date');
                                    }
                                    
                                    tocreate[colfieldName] = col_old_value;
                                    colfield_index++;
                                });
                            }
                        }
                        console.log("tocreate============>",tocreate,)
                        if (tocreate && Object.keys(tocreate).length > 0 && tocreate[cell.measure] !== undefined && tocreate[cell.measure] !== null && tocreate[cell.measure] != 0) {
                            tocreate['name'] = cell.name || '-';
                            creates.push(tocreate);
                        }
                        
                    }
                    cell_index++;
                }
            }
            let new_col_index=0;
            var self=this;
            $('tbody').find('tr').eq(row_index).find('.new_col').each(function(){
                const firstchild=$(this.firstChild);
                const firstchild_id=firstchild.attr('id');
                const firstchild_id_split=firstchild_id.split('_');
                const firstchild_measure=firstchild_id_split[1];
                const firstchild_position=firstchild_id_split[3];
                const firstchid_value=firstchild.val();
                const newcol_cell=row.subGroupMeasurements[0]
                if (firstchid_value!==null && firstchid_value!==undefined && firstchid_value!==0 && firstchid_value!=''){
                    let newcol_tocreate={'name':'-'};
                    newcol_tocreate[firstchild_measure]=firstchid_value;
                    let newcol_row_index=0;
                    self.model.metaData.rowGroupBys.forEach(field => {
                        const fieldName = field.split(':')[0];
                        const fieldInfo = self.model.metaData.fields[fieldName];
                        //var gbys_new_value = $("#"+fieldName+"_"+row_index);
                        var gbys_new_value=newcol_cell.groupId[0][newcol_row_index];
                        if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'datetime')) {
                            gbys_new_value = self.formatDate(gbys_new_value, 'date');
                        }
                        
                        newcol_tocreate[fieldName] = gbys_new_value;
                        newcol_row_index++;
                    });
                    self.model.metaData.colGroupBys.forEach(colfield => {
                        const colfieldName = colfield.split(':')[0];
                        const colfieldInfo = self.model.metaData.fields[colfieldName];
                        var col_old_value = $('#newcol_'+colfieldName+'_'+firstchild_position).attr('data-value');
                        if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                            col_old_value = self.formatDate(col_old_value, 'date');
                        }
                        
                        newcol_tocreate[colfieldName] = col_old_value;
                    });
                    creates.push(newcol_tocreate)
                }
                

            });
            row_index++;
        }
        
        setTimeout(async function() {
            this.state.edits = edits;

            console.log("*********this.state.edits************",this.state.edits);
            console.log("*********this.model.data.newRows************",this.model.data.newRows);
            try {
            
                const modelFields = await this.orm.call(
                    this.model.metaData.resModel, 
                    'fields_get',
                    [],
                    { attributes: ['string', 'type', 'required'] }
                );
                
                console.log("------creates-------", creates);
                console.log("---------updates---------", updates);
                if (creates.length) {
                    await this.orm.create(
                        this.model.metaData.resModel,
                        creates 
                    );
                }
                
                if (updates.length) {
                    for (const update of updates) {
                        await this.orm.write(
                            this.model.metaData.resModel,
                            [update.id],
                            update.changes
                        );
                    }
                }

                this.model.data.newRows = [];
                this.state.isEditing = false;
                this.state.edits = {};
                await this.model.load(this.model.searchParams);
                
                
                this.notification.add(_t("Changes saved successfully"), { type: "success" });
                $('.o_matrix_edit').show();
                $('.o_matrix_download').show();
                $('.o_matrix_save').hide();
                $('.o_matrix_cancel').hide();
                this.model.notify();
                this.render();
                setTimeout(function(){ window.location.reload();},100);
            } catch (error) {
                console.error("Save error:", error);
                this.notification.add(_t("Error saving changes"), { type: "danger" });
            }
        }.bind(this), 400);
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
        $('.new_col').remove();
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
                this.state.edits[newRowId][fieldName] = field.value?field.value:null;
                /*field.subGroupMeasurements.forEach(cell => {
                    this.state.edits[newRowId][cell.measure] = null;
                });*/
            });
        }
        this.render();
        setTimeout(function(){
            //const firstInput = $('.edit_mode').first();
            const lastNewRow = this.model.data.newRows.length - 1;
            const InputToFocus = $('tr[class="o_matrix_new_row"]').eq(lastNewRow).find('.edit_mode').first();
            if (InputToFocus) {
                InputToFocus.focus();
            }
        }.bind(this),100);
    }

    async onAddColumnClicked(cell,cell_index,model) {
        console.log("onAddColumnClicked", cell,cell_index,model);
        const th = document.querySelector(`th[name="${cell.name}"][index="${cell_index}"]`);
        var count_new_col = th.closest('tr').querySelectorAll('th.new_col').length || 0;
        const newTh = document.createElement('th');
        newTh.classList.add('new_col');
        const next_cell_index=cell_index+1+count_new_col;
        newTh.setAttribute('name', '${cell.name}');
        newTh.setAttribute('index', '${next_cell_index}');
        newTh.setAttribute('colspan', '{th.getAttribute("colspan")}');
        newTh.setAttribute('rowspan', '{th.getAttribute("rowspan")}');
        const div_many2one = `
        <div class="o_field_widget o_field_many2one" name="${cell.name}">
            <div class="o_field_many2one_selection">
            <div class="o_input_dropdown" id="div_${next_cell_index}_${cell.name}">
                <div class="o-autocomplete dropdown">
                <input type="text" class="o-autocomplete--input o_input edit_mode"
                        autocomplete="off" placeholder=""
                        style="margin-top:3px!important;height: 30px!important;" name="${cell.name}">
                </div>
                <span class="o_dropdown_button" style="top:13px!important;"></span>
            </div>
            </div>
            <div class="o_field_many2one_extra"></div>
        </div>`;
        /*newTh.innerHTML = div_many2one;
        th.insertAdjacentElement('afterend', newTh);
        const dropdownDiv = newTh.querySelector(`#div_${next_cell_index}_${cell.name}`);
        if (dropdownDiv) {
            dropdownDiv.addEventListener('click', (ev) => {
                this.displayMany2oneRecord(ev, cell.name, next_cell_index, cell);
            });
        }*/
        this.table.headers.forEach((headerRow, index) => {
            if (index > 0) {
                const headerRow_th = document.querySelector(`th[name="${headerRow[0].name}"][index="${headerRow.length-1}"]`);
                const headerRow_newTh = document.createElement('th');
                headerRow_newTh.classList.add('new_col');
                const next_headerRow_index=headerRow.length;
                headerRow_newTh.setAttribute('name', '${headerRow[0].name}');
                headerRow_newTh.setAttribute('index', '${next_headerRow_index}');
                headerRow_newTh.setAttribute('colspan', '{headerRow_th.getAttribute("colspan")}');
                headerRow_newTh.setAttribute('rowspan', '{headerRow_th.getAttribute("rowspan")}');
                const headerRow_div_many2one = `
                <div class="o_field_widget o_field_many2one" name="${headerRow[0].name}">
                    <div class="o_field_many2one_selection">
                    <div class="o_input_dropdown" id="div_${next_headerRow_index}_${headerRow[0].name}">
                        <div class="o-autocomplete dropdown">
                            <input type="text" class="o-autocomplete--input o_input edit_mode"
                                autocomplete="off" placeholder="" id="${'newcol_'+headerRow[0].name+'_'+next_cell_index}"
                                style="margin-top:3px!important;height: 30px!important;" name="${headerRow[0].name}">
                        </div>
                        <span class="o_dropdown_button" style="top:13px!important;"></span>
                    </div>
                    </div>
                    <div class="o_field_many2one_extra"></div>
                </div>`;
                headerRow_newTh.innerHTML = headerRow_div_many2one;
                headerRow_th.insertAdjacentElement('afterend', headerRow_newTh);
                const headerRowdropdownDiv = headerRow_newTh.querySelector(`#div_${next_headerRow_index}_${headerRow[0].name}`);
                if (headerRowdropdownDiv) {
                    headerRowdropdownDiv.addEventListener('click', (ev) => {
                        this.displayMany2oneRecord(ev, headerRow[0].name, next_headerRow_index, headerRow);
                    });
                }
            }
        });
        //duplicate last measure header
        const thead = document.querySelector('table thead');
        const headerRows = thead.querySelectorAll('tr');
        const lastHeaderRow = headerRows[headerRows.length - 1];
        const lastTh = lastHeaderRow.querySelector('th:last-of-type');
        const newMeasureTh = lastTh.cloneNode(true);
        newMeasureTh.classList.add('new_col');
        //lastHeaderRow.appendChild(newMeasureTh);
        lastTh.insertAdjacentElement('afterend', newMeasureTh);

        const rows = document.querySelectorAll('table tbody tr');
        let row_index=0;
        //let len_rows=this.table.rows.length-1;
        rows.forEach((row) => {
            let measure_name = this.table.rows[0].subGroupMeasurements[0].measure;
            var rowgroupbys_length=this.model.metaData.rowGroupBys.length;
            const $row = $(`#${measure_name}_${row_index}_0`).closest('tr');
            const len_row=$row.find('td:not(.new_col)').length-1-rowgroupbys_length;
            const inputId = `${measure_name}_${row_index}_${len_row}`;

            // Find the element with jQuery (proper scoping if needed)
            const $input = $(`#${inputId}`);

            if ($input.length) {  // Check if element exists
                const $lastTd = $input.parent();
                
                // Create new TD with jQuery
                const $newTd = $lastTd.clone(true);
                $newTd.empty();
                $newTd.addClass('new_col');
                $newTd.html(`<input type="number" class="form-control edit_mode" id="newcol_${measure_name}_${row_index}_${next_cell_index}">`);
                $lastTd.after($newTd);
            } else {
                console.error(`Element with ID ${inputId} not found`);
            }
            row_index++;
        });
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


// Add default values for required fields not in the changes
_addDefaultValues(changes, requiredFields) {
    const completeChanges = { ...changes };
    
    // Check for any required fields not in our changes
    const missingRequired = requiredFields.filter(
        field => !(field in completeChanges)
    );
    
    // Set default values for missing required fields
    missingRequired.forEach(field => {
        completeChanges[field] = this._getDefaultValueForField(field);
    });
    
    return completeChanges;
}

// Get sensible default values for different field types
_getDefaultValueForField(fieldName) {
    const field = this.model.metaData.fields[fieldName];
    if (!field) return false; // Fallback
    
    switch (field.type) {
        case 'char':
            return '-';
        case 'text':
            return '-';
        case 'integer':
            return 0;
        case 'float':
            return 0;
        case 'monetary':
            return 0;
        case 'boolean':
            return false;
        case 'date':
            return moment().format('YYYY-MM-DD');
        case 'datetime':
            return moment().format('YYYY-MM-DD HH:mm:ss');
        case 'many2one':
            return false; // False is valid for unset many2one
        case 'selection':
            const options = field.selection || [];
            return options.length ? options[0][0] : false;
        default:
            return false;
    }
}

   
}
MatrixRenderer.template = "matrix_view.MatrixRenderer";
MatrixRenderer.components = { Dropdown, DropdownItem, CheckBox, MatrixGroupByMenu };
MatrixRenderer.props = ["model", "buttonTemplate?"];
MatrixRenderer.defaultProps = {
    buttonTemplate: "matrix_view.MatrixView.Buttons",
};


