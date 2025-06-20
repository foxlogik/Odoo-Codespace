/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { MatrixArchParser } from "./matrix_arch_parser";
import { MatrixController } from "./matrix_controller";
import { MatrixModel } from "./matrix_model";
import { MatrixRenderer } from "./matrix_renderer";
import { MatrixSearchModel } from "./matrix_search_model";

const  viewRegistry = registry.category("views");


export const matrixView = {
    type: "matrix",
    display_name: _t("Matrix"),
    icon: "fa fa-table",
    multiRecord: true,
    Controller: MatrixController,
    Renderer: MatrixRenderer,
    Model: MatrixModel,
    ArchParser: MatrixArchParser,
    SearchModel: MatrixSearchModel,
    searchMenuTypes: ["filter", "groupBy", "comparison", "favorite"],

    props: (genericProps, view) => {
        const modelParams = {};
        if (genericProps.state) {
            modelParams.data = genericProps.state.data;
            modelParams.metaData = genericProps.state.metaData;
        } else {
            const { arch, fields, resModel } = genericProps;

            // parse arch
            const archInfo = new view.ArchParser().parse(arch);

            if (!archInfo.activeMeasures.length || archInfo.displayQuantity) {
                archInfo.activeMeasures.unshift("__count");
            }

            modelParams.metaData = {
                activeMeasures: archInfo.activeMeasures,
                colGroupBys: archInfo.colGroupBys,
                defaultOrder: archInfo.defaultOrder,
                disableLinking: Boolean(archInfo.disableLinking),
                fields: fields,
                fieldAttrs: archInfo.fieldAttrs,
                resModel: resModel,
                rowGroupBys: archInfo.rowGroupBys,
                title: archInfo.title || _t("Untitled"),
                widgets: archInfo.widgets,
                colFields: archInfo.colFields,
                domainFields: archInfo.domainFields,
            };
        }

        return {
            ...genericProps,
            Model: view.Model,
            modelParams,
            Renderer: view.Renderer,
        };
    },
};

viewRegistry.add("matrix", matrixView);
