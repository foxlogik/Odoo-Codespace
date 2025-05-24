/** @odoo-module **/

import { Layout } from "@web/search/layout";
import { useModelWithSampleData } from "@web/model/model";
import { standardViewProps } from "@web/views/standard_view_props";
import { useSetupView } from "@web/views/view_hook";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { useSearchBarToggler } from "@web/search/search_bar/search_bar_toggler";
import { CogMenu } from "@web/search/cog_menu/cog_menu";

import { Component, useRef } from "@odoo/owl";

export class MatrixController extends Component {
    setup() {
        this.model = useModelWithSampleData(this.props.Model, this.props.modelParams);
        
        useSetupView({
            rootRef: useRef("root"),
            getLocalState: () => {
                const { data, metaData } = this.model;
                return { data, metaData };
            },
            getContext: () => this.getContext(),
        });
        this.searchBarToggler = useSearchBarToggler();
    }
    /**
     * @returns {Object}
     */
    getContext() {
        return {
            matrix_measures: this.model.metaData.activeMeasures,
            matrix_column_groupby: this.model.metaData.fullColGroupBys,
            matrix_row_groupby: this.model.metaData.fullRowGroupBys,
        };
    }
}

MatrixController.template = "matrix_view.MatrixView";
MatrixController.components = { Layout, SearchBar, CogMenu };

MatrixController.props = {
    ...standardViewProps,
    Model: Function,
    modelParams: Object,
    Renderer: Function,
    buttonTemplate: { type: String, optional: true },
};
