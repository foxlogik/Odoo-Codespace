from odoo import models, fields, api

class IrUIView(models.Model):
    _inherit = 'ir.ui.view'

    type = fields.Selection(selection_add=[('matrix', "Matrix")])

class IrActionsActWindowView(models.Model):
    _inherit = 'ir.actions.act_window.view'
    view_mode = fields.Selection(selection_add=[('matrix', "Matrix")],ondelete={'matrix': 'cascade'})

class MatrixViewMixin(models.AbstractModel):
    _name = 'matrix.view.mixin'
    _description = 'Matrix View Mixin'

    def get_matrix_data(self, row_fields, col_fields, measure_field='amount', domain=None):
        domain = domain or []
        all_fields = row_fields + col_fields + [measure_field]

        # GROUP BY rows + cols
        grouped_data = self.read_group(
            domain=domain,
            fields=all_fields,
            groupby=row_fields + col_fields,
            lazy=False,
        )

        rows = set()
        cols = set()
        values = {}
        labels = {}

        def get_label(field_name, value):
            """Resolve label for M2O or keep value for simple fields."""
            if not value:
                return '-'
            if field_name in self._fields and self._fields[field_name].type == 'many2one':
                return self.env[self._fields[field_name].comodel_name].browse(value).name
            return str(value)

        for entry in grouped_data:
            row_key = tuple(entry.get(f) for f in row_fields)
            col_key = tuple(entry.get(f) for f in col_fields)

            rows.add(row_key)
            cols.add(col_key)

            row_labels = tuple(get_label(f, entry.get(f)) for f in row_fields)
            col_labels = tuple(get_label(f, entry.get(f)) for f in col_fields)

            labels.setdefault('rows', {})[row_key] = row_labels
            labels.setdefault('cols', {})[col_key] = col_labels

            values.setdefault(row_key, {})[col_key] = entry.get(measure_field)

        return {
            'rowFields': row_fields,
            'colFields': col_fields,
            'measureField': measure_field,
            'rows': list(rows),
            'cols': list(cols),
            'values': values,
            'labels': labels,
        }
    
    def _get_matrix_dimension(self, records, fields):
        dimension = []
        seen = set()
        
        for record in records:
            key = self._get_record_key(record, fields)
            if key not in seen:
                dimension.append({
                    'key': key,
                    'label': self._get_record_label(record, fields),
                    'values': {f: record[f] for f in fields}
                })
                seen.add(key)
        
        return dimension

    def _get_record_key(self, record, fields):
        return '|'.join(str(record[f]) for f in fields)

    def _get_record_label(self, record, fields):
        return ' / '.join(str(record[f]) for f in fields)
