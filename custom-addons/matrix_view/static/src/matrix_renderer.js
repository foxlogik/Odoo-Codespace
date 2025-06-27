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
            isEditing: true,
        });
        this._m2oOptions = [];
        this.resizing = false;
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".o_input_dropdown")) {
                $(".o-autocomplete--dropdown-menu").remove();
            }
        });
    }
    
    onStartResize(ev) {
        this.resizing = true;
        console.log("Start resizing", ev);
        console.log("ev.target", ev.target);
        console.log("ev.target.closest", ev.target.closest("th"));
        console.log("ev.target.closest('.o_resize')", ev.target.closest(".o_resize"));
        console.log("this.tableRef", this.tableRef);
        console.log("this.tableRef.el", this.tableRef.el);
        if (!this.tableRef.el) {
            console.error("Table element not found");
            return;
        }
        const table = this.tableRef.el;
        const th = ev.target.closest("th");
        const handler = th.querySelector(".o_resize");
        table.style.width = `${Math.floor(table.getBoundingClientRect().width)}px`;
        const thPosition = [...th.parentNode.children].indexOf(th);
        const resizingColumnElements = [...table.getElementsByTagName("tr")]
            .filter((tr) => tr.children.length === th.parentNode.children.length)
            .map((tr) => tr.children[thPosition]);
        const initialX = ev.clientX;
        const initialWidth = th.getBoundingClientRect().width;
        const initialTableWidth = table.getBoundingClientRect().width;
        const resizeStoppingEvents = ["keydown", "pointerdown", "pointerup"];

        // fix the width so that if the resize overflows, it doesn't affect the layout of the parent
        if (!this.rootRef.el.style.width) {
            this.rootRef.el.style.width = `${Math.floor(
                this.rootRef.el.getBoundingClientRect().width
            )}px`;
        }

        // Apply classes to table and selected column
        table.classList.add("o_resizing");
        for (const el of resizingColumnElements) {
            el.classList.add("o_column_resizing");
            handler.classList.add("bg-primary", "opacity-100");
            handler.classList.remove("bg-black-25", "opacity-50-hover");
        }
        const columnIndex = [...th.parentNode.children].indexOf(th);
        const allBodyRows = table.querySelectorAll("tbody tr");
        const bodyCells = Array.from(allBodyRows).map(row => row.children[columnIndex]);
        // Mousemove event : resize header
        const resizeHeader = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const delta = ev.clientX - initialX;
            const newWidth = Math.max(10, initialWidth + delta);
            const tableDelta = newWidth - initialWidth;
            th.style.width = `${Math.floor(newWidth)}px`;
            th.style.maxWidth = `${Math.floor(newWidth)}px`;
            table.style.width = `${Math.floor(initialTableWidth + tableDelta)}px`;
            for (const cell of [...resizingColumnElements, ...bodyCells]) {
                console.log("Resizing cell", cell);
                cell.style.width = `${Math.floor(newWidth)}px`;
                $(cell).find(".o_input_dropdown").css("width", `${Math.floor(newWidth-15)}px`);
                cell.style.maxWidth = `${Math.floor(newWidth)}px`;
                $(cell).find(".o_input_dropdown").css("maxWidth", `${Math.floor(newWidth-15)}px`);
            }
        };
        window.addEventListener("pointermove", resizeHeader);

        // Mouse or keyboard events : stop resize
        const stopResize = (ev) => {
            this.resizing = false;
            // freeze column size after resizing
            this.keepColumnWidths = true;
            // Ignores the 'left mouse button down' event as it used to start resizing
            if (ev.type === "pointerdown" && ev.button === 0) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();

            table.classList.remove("o_resizing");
            for (const el of resizingColumnElements) {
                el.classList.remove("o_column_resizing");
                handler.classList.remove("bg-primary", "opacity-100");
                handler.classList.add("bg-black-25", "opacity-50-hover");
            }

            window.removeEventListener("pointermove", resizeHeader);
            for (const eventType of resizeStoppingEvents) {
                window.removeEventListener(eventType, stopResize);
            }

            // we remove the focus to make sure that the there is no focus inside
            // the tr.  If that is the case, there is some css to darken the whole
            // thead, and it looks quite weird with the small css hover effect.
            document.activeElement.blur();
        };
        // We have to listen to several events to properly stop the resizing function. Those are:
        // - pointerdown (e.g. pressing right click)
        // - pointerup : logical flow of the resizing feature (drag & drop)
        // - keydown : (e.g. pressing 'Alt' + 'Tab' or 'Windows' key)
        for (const eventType of resizeStoppingEvents) {
            window.addEventListener(eventType, stopResize);
        }
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
    async getMany2OneOptions(fieldName,row,row_id=null) {
        console.log("getMany2OneOptions", row);
        const field = this.model.metaData.fields[fieldName];
        const fieldAttrs = this.model.metaData.fieldAttrs[fieldName];
        console.log("domainFields", this.model.metaData.domainFields,this.model.metaData.fields);        
        if (field.type === "many2one") {
            const model = field.relation;
            let domain = [];
            const pattern = "(company_id and ['|', ('company_id', '=', False), ('company_id', 'parent_of', [company_id])] or ['|', ('company_id', '=', False), ('company_id', 'parent_of', [''])])";
            const pattern2 = "(company_id and ['|', ('company_id', '=', False), ('company_id', 'in', [company_id])] or [('company_id', '=', False)]) + ([])";
            if (field.domain || fieldAttrs?.domain) {
                // Replace the pattern with the actual company_id
                var fieldDomain = fieldAttrs?.domain?fieldAttrs.domain:field.domain;
                
                fieldDomain=JSON.stringify(fieldDomain);
                if (fieldDomain.includes(pattern)) {
                    console.log("fieldDomain inside includes pattern",fieldDomain);
                    domain = companyId
                                ? ['|', ['company_id', '=', false], ['company_id', 'parent_of', companyId]]
                                : ['|', ['company_id', '=', false], ['company_id', 'parent_of', '']];
                } else if (fieldDomain.includes(pattern2)) {
                    console.log("fieldDomain inside includes pattern2",fieldDomain);
                    domain = companyId
                                ? ['|', ['company_id', '=', false], ['company_id', 'in', [companyId]]]
                                : [['company_id', '=', false]];
                }
                else{
                    fieldDomain = fieldAttrs?.domain? fieldAttrs.domain : field.domain;
                    
                    try {
                        console.log("fieldDomain after pattern check - try",fieldDomain);
                        domain = new Domain(fieldDomain).toList();
                        
                    }
                    catch (e) {
                        //fieldDomain = JSON.stringify(fieldDomain);
                        console.log("fieldDomain after pattern check - catch ",fieldDomain);
                        let fieldDomainSplitted=fieldDomain.split(",");
                        console.log("fieldDomainSplitted",fieldDomainSplitted);
                        for (let f = 0; f < fieldDomainSplitted.length; f++) {
                            console.log("fieldDomainSplitted[f]",fieldDomainSplitted[f]);
                            let fSplitted=fieldDomainSplitted[f].replace(" ","").replace(")","").replace("]","").replace(",","");
                            if (this.model.metaData.fields[fSplitted]!== undefined && this.model.metaData.fields[fSplitted].name !== undefined) {
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+')]', "'"+String(this.model.metaData.fields[fSplitted].name) + "')]");
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+'),]', "'"+String(this.model.metaData.fields[fSplitted].name) + "'),]");
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+') ]', "'"+String(this.model.metaData.fields[fSplitted].name) + "') ]");
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+' ),]', "'"+String(this.model.metaData.fields[fSplitted].name) + "' ),]");
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+' ) ]', "'"+String(this.model.metaData.fields[fSplitted].name) + "' ) ]");
                                fieldDomain=fieldDomain.replace(", "+this.model.metaData.fields[fSplitted].name, ", '"+String(this.model.metaData.fields[fSplitted].name) +"'");
                                fieldDomain=fieldDomain.replace(this.model.metaData.fields[fSplitted].name+')', "'"+String(this.model.metaData.fields[fSplitted].name) + "')");
                            }
                        }
                        console.log("fieldDomain after replacing fields",fieldDomain);
                        domain = new Domain(fieldDomain).toList();
                    }
                }
            }
            console.log("domain",domain);
            
            if (domain){
                for (let i = 0; i < domain.length; i++) {
                    if (this.model.metaData.domainFields.includes(domain[i][2]) || this.model.metaData.fields[domain[i][2]]!== undefined) {
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
                        console.log(this.model.metaData.colGroupBys)
                        if (this.model.metaData.colGroupBys && this.model.metaData.colGroupBys.includes(fieldName) && this.model.metaData.domainFields.includes(domain[i][2])) {
                            console.warn("Many2one field in colGroupBys, skipping domain modification", fieldName);
                            const many2onedomain_records = await this.orm.searchRead(this.model.metaData.resModel, [[domain[i][2],'!=',null],[domain[i][2],'!=',[]]], [domain[i][2]],{limit:1});
                            console.log("many2onedomain_records",many2onedomain_records);
                            if (this.model.metaData.fields[domain[i][2]] && this.model.metaData.fields[domain[i][2]].type === 'many2one') {
                                domain[i][2]=many2onedomain_records[0][domain[i][2]][0];
                            }
                            else{
                                domain[i][2]=many2onedomain_records[0][domain[i][2]];
                            }
                        }
                        else if (!row.isNew){
                            if (this.model.metaData.rowGroupBys.includes(domain[i][2])){
                                console.warn("Many2one field in rowGroupBys, modifying domain", domain[i][2]);
                                console.log("row.groupId",row.groupId);
                                console.log("row.data",row.data);
                                console.log("domain[i][2]",domain[i][2]);
                                console.log("row_id",row_id);
                                const dropdownEl = "#div_"+row_id+"_"+domain[i][2];
                                console.log("dropdownEl",dropdownEl);
                                const $input = $(dropdownEl).find("input.o-autocomplete--input");
                                console.log("$input", $input);
                                console.log("$input.length", $input.length);
                                console.log("$input.attr('data-value')", $input.attr('data-value'));
                                if ($input.length && $input.attr('data-value') !== undefined && $input.attr('data-value') !== null && $input.attr('data-value') !== '') {
                                    if (this.model.metaData.fields[domain[i][2]].type === 'many2one') {
                                        domain[i][2] = parseInt($input.attr('data-value'));
                                    }
                                    else {
                                        domain[i][2] = $input.attr('data-value');
                                    }
                                    console.log("domain[i][2] set from input", domain[i][2]);
                                }
                                else if (row.data && row.data[domain[i][2]] && (row.data[domain[i][2]].value !== undefined || row.data[domain[i][2]].id !== undefined)) {
                                    domain[i][2] = row.data[domain[i][2]].value? row.data[domain[i][2]].value : row.data[domain[i][2]].id;
                                    console.log("domain[i][2] set from row data", domain[i][2]);
                                }
                            }
                            else{
                                let many2onedomain=formatGroup(this.model.metaData.rowGroupBys, row.groupId[0]);
                                const many2onedomain_records = await this.orm.searchRead(this.model.metaData.resModel, many2onedomain, [domain[i][2]]);
                                console.log("many2onedomain_records",many2onedomain_records);
                                if (this.model.metaData.fields[domain[i][2]] && this.model.metaData.fields[domain[i][2]].type === 'many2one') {
                                    domain[i][2]=many2onedomain_records[0][domain[i][2]][0];
                                    console.log("domain[i][2] set from many2onedomain_records-type many2one", domain[i][2]);
                                }
                                else{
                                    domain[i][2]=many2onedomain_records[0][domain[i][2]];
                                    console.log("domain[i][2] set from many2onedomain_records", domain[i][2]);
                                }
                            }
                        }
                        else if (row.data && row.data[domain[i][2]] && (row.data[domain[i][2]].value !== undefined || row.data[domain[i][2]].id !== undefined)) {
                            domain[i][2] = row.data[domain[i][2]].value? row.data[domain[i][2]].value : row.data[domain[i][2]].id;
                        }
                        else if (this.model.metaData.domainFields.includes(domain[i][2]) && row.isNew){
                            domain=[];
                        }
                        

                        
                    }
                }
            }
            console.log("Final domain for many2one options", domain);
            const records = await this.orm.searchRead(model, domain, ["display_name"]);
            return records;
        }
        return [];
    }
    async displayMany2oneRecord(ev, fieldName,row_id,row) {
        // Remove any existing dropdown first
        $(".o-autocomplete--dropdown-menu").remove();   
        const options = await this.getMany2OneOptions(fieldName,row,row_id);
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
        console.log("Selected Many2OneOption: ", option.id, '-', option.display_name);
        console.log("fieldName",fieldName);
        console.log("input",input);
        input.val(option.display_name);
        input.attr('data-value', option.id);
        input.closest('td').attr('data-tooltip', option.display_name);
        // Set the value of the row data to the selected option
        if (row.data){
            row.data[fieldName] = { id: option.id, label: option.display_name };
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
    
    //Save Button to save the modified datas and render the readonly mode
    
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
                else if (fieldInfo && fieldInfo.type === 'datetime') {
                    value = this.formatDate(value, 'datetime');
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
                            console.log("row is new, creating new record for cell", row.data);
                            const fieldName = cell.measure;
                            const new_value = $('#' + fieldName + '_' + row_index + '_' + cell_index).val();
                            if (new_value !== undefined && new_value !== null && new_value != 0){
                                tocreate[fieldName] = new_value;
                            }
                            var row_field_index=0
                            this.model.metaData.rowGroupBys.forEach(field => {
                                const fieldName = field.split(':')[0];
                                const fieldInfo = this.model.metaData.fields[fieldName];
                                const fieldAttrs = this.model.metaData.fieldAttrs[fieldName];
                                console.log(fieldAttrs, fieldAttrs.isInvisible)
                                if (fieldAttrs && fieldAttrs.isInvisible === true) {
                                    console.log("row.data[fieldName]?.value", row.data[fieldName]?.value);
                                    tocreate[fieldName] = row.data[fieldName]?.value || '';
                                }
                                else {
                                    var gbys_new_value = $('#' + fieldName + '_' + row_index).attr('data-value');
                                    if (!gbys_new_value || gbys_new_value === undefined || gbys_new_value === null) {
                                        if (fieldInfo && fieldInfo.type === 'many2one') {
                                            gbys_new_value = row.data[fieldName]?.id || '';
                                        }
                                        else {
                                            gbys_new_value = row.data[fieldName]?.value || '';
                                        }
                                    }
                                    if (fieldInfo && (fieldInfo.type === 'date' || fieldInfo.type === 'datetime')) {
                                        gbys_new_value = this.formatDate(gbys_new_value, fieldInfo.type);
                                    }
                                    tocreate[fieldName] = gbys_new_value;
                                }
                                
                                row_field_index++;
                            });
                            var colfield_index=0
                            this.model.metaData.colGroupBys.forEach(colfield => {
                                const colfieldName = colfield.split(':')[0];
                                const colfieldInfo = this.model.metaData.fields[colfieldName];
                                var col_old_value = cell.groupId[1][colfield_index];
                                if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                                    col_old_value = this.formatDate(col_old_value, colfieldInfo.type);
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
                                            else if (fieldInfo && fieldInfo.type === 'datetime') {
                                                gbys_new_value = this.formatDate(gbys_new_value, 'datetime');
                                                gbys_old_value = this.formatDate(gbys_old_value, 'datetime');
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
                                            else if (fieldInfo && fieldInfo.type === 'datetime') {
                                                gbys_new_value = this.formatDate(gbys_new_value, 'datetime');
                                                gbys_old_value = this.formatDate(gbys_old_value, 'datetime');
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
                                                    col_old_value = this.formatDate(col_old_value, colfieldInfo.type);
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
                                        else if (fieldInfo && fieldInfo.type === 'datetime') {
                                            gbys_new_value = this.formatDate(gbys_new_value, 'datetime');
                                            gbys_old_value = this.formatDate(gbys_old_value, 'datetime');
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
                                        else if (fieldInfo && fieldInfo.type === 'datetime') {
                                            gbys_new_value = this.formatDate(gbys_new_value, 'datetime');
                                            gbys_old_value = this.formatDate(gbys_old_value, 'datetime');
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
                                                col_old_value = this.formatDate(col_old_value, colfieldInfo.type);
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
                                        gbys_new_value = this.formatDate(gbys_new_value, fieldInfo.type);
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
                                        col_old_value = this.formatDate(col_old_value, colfieldInfo.type);
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
                            gbys_new_value = self.formatDate(gbys_new_value, fieldInfo.type);
                        }
                        
                        newcol_tocreate[fieldName] = gbys_new_value;
                        newcol_row_index++;
                    });
                    self.model.metaData.colGroupBys.forEach(colfield => {
                        const colfieldName = colfield.split(':')[0];
                        const colfieldInfo = self.model.metaData.fields[colfieldName];
                        var col_old_value = $('#newcol_'+colfieldName+'_'+firstchild_position).attr('data-value');
                        if (colfieldInfo && (colfieldInfo.type === 'date' || colfieldInfo.type === 'datetime')) {
                            col_old_value = self.formatDate(col_old_value, colfieldInfo.type);
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
                this.state.isEditing = true;
                this.state.edits = {};
                await this.model.load(this.model.searchParams);
                
                
                this.notification.add(_t("Changes saved successfully"), { type: "success" });
                //$('.o_matrix_edit').show();
                //$('.o_matrix_download').show();
                //$('.o_matrix_save').hide();
                //$('.o_matrix_cancel').hide();
                this.model.notify();
                this.render();
                //setTimeout(function(){ window.location.reload();},100);
            } catch (error) {
                console.error("Save error:", error);
                this.notification.add(_t("Error saving changes"), { type: "danger" });
            }
        }.bind(this), 400);
    }
    //Cancel Button to cancel the ongoing modifications and render the readonly mode
    onCancelButtonClicked(){
        //$('.o_matrix_edit').show();
        //$('.o_matrix_download').show();
        //$('.o_matrix_save').hide();
        //$('.o_matrix_cancel').hide();
        
        // Reset model state
        this.model.data.newRows = [];
        this.model.load(this.model.searchParams);
        
        // Reset UI state
        this.state.isEditing = true;
        this.state.edits = {};
        $('.new_col').remove();
        this.model.notify();
        this.render();
        //setTimeout(function(){ window.location.reload();},100);
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
        const next_cell_index=cell_index+1+count_new_col;
        
        const defaults = await this.model.orm.call(this.model.metaData.resModel, "default_get", [this.model.metaData.rowGroupBys.map(gb => gb.split(':')[0])]);
        console.log("this.model.searchParams.context",this.model.searchParams.context)
        for (const [key, val] of Object.entries(this.model.searchParams.context)) {
            if (key.startsWith("default_")) {
                const fieldName = key.slice(8);  // Remove "default_" prefix
                defaults[fieldName] = val;
            }
        }  
        console.log("defaults",defaults)
        let index = 0;
        for (const headerRow of this.table.headers) {
            if (index > 0) {
                const headerRow_th = document.querySelector(`th[name="${headerRow[0].name}"][index="${headerRow.length-1}"]`);
                const headerRow_newTh = document.createElement('th');
                headerRow_newTh.classList.add('new_col');
                const next_headerRow_index=headerRow.length;
                headerRow_newTh.setAttribute('name', '${headerRow[0].name}');
                headerRow_newTh.setAttribute('index', '${next_headerRow_index}');
                headerRow_newTh.setAttribute('colspan', '{headerRow_th.getAttribute("colspan")}');
                headerRow_newTh.setAttribute('rowspan', '{headerRow_th.getAttribute("rowspan")}');
                const fieldName=headerRow[0].name;
                const fieldInfo = this.model.metaData.fields[fieldName];
                let defaultValue = defaults[fieldName] || '';
                let defaultValueLabel = defaults[fieldName] || '';
                if (fieldInfo && fieldInfo.type === 'many2one') {
                        let record = await this.model.orm.searchRead(fieldInfo.relation,[['id','=',defaults[fieldName]]] , ["display_name"]);
                        defaultValueLabel= record.length > 0 ? record[0].display_name : '';
                }
                let isReadonly=this.model.metaData.fieldAttrs[fieldName].isReadonly;
                console.log(fieldName,"isReadonly:",isReadonly)
                const headerRow_div_many2one = `
                <div class="o_field_widget o_field_many2one" name="${headerRow[0].name}">
                    <div class="o_field_many2one_selection">
                    <div class="o_input_dropdown" id="div_${next_headerRow_index}_${headerRow[0].name}">
                        <div class="o-autocomplete dropdown">
                            <input type="text" class="o-autocomplete--input o_input edit_mode"
                                autocomplete="off" placeholder="" id="${'newcol_'+headerRow[0].name+'_'+next_cell_index}"
                                style="margin-top:3px!important;height: 30px!important;min-width:190px;`+(isReadonly ? `background-color:#f8f9fa!important;border:none!important;` : '')+`" name="${headerRow[0].name}"
                                value="${defaultValueLabel || ''}"
                                data-value="${defaultValue || ''}" `+(isReadonly ? `disabled="disabled"` : '')+`>
                        </div>`+
                        
                        (!isReadonly ? `<span class="o_dropdown_button" style="top:13px!important;"></span>` : '')+`
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
            index++;
        }
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

        let len_rows=this.table.rows.length-1;
        let len_rows_tr =rows.length-1;
        console.log("len_rows",len_rows);
        console.log("len_rows_tr",len_rows_tr);
        let rowgroupbys_length=this.model.metaData.rowGroupBys.length;
        this.model.metaData.rowGroupBys.forEach((RowField, RowIndex) => {
            const RowfieldName = RowField.split(':')[0];
            const RowfieldAttrs = this.model.metaData.fieldAttrs[RowfieldName];
            if (RowfieldAttrs && RowfieldAttrs.isInvisible) {
                rowgroupbys_length=rowgroupbys_length-1; // Do not count invisible fields
            }
        });
        rows.forEach((row) => {
            let measure_name = this.table.rows[0].subGroupMeasurements[0].measure;
            //console.log("this.model.metaData.rowGroupBys",this.model.metaData.rowGroupBys,this.table.rows[row_index]);
            let isMeasureReadonly=this.model.metaData.fieldAttrs[measure_name].isReadOnly;
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
                $newTd.html(`<input type="number" class="form-control edit_mode" id="newcol_${measure_name}_${row_index}_${next_cell_index}"` +(isMeasureReadonly ? `disabled="disabled" style="background-color:#f8f9fa!important;border:none!important;"` : '')+`>`);
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
   
}
MatrixRenderer.template = "matrix_view.MatrixRenderer";
MatrixRenderer.components = { Dropdown, DropdownItem, CheckBox, MatrixGroupByMenu };
MatrixRenderer.props = ["model", "buttonTemplate?"];
MatrixRenderer.defaultProps = {
    buttonTemplate: "matrix_view.MatrixView.Buttons",
};


