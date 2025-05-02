from odoo import http
from odoo.http import request
from collections import defaultdict

# class MatrixController(http.Controller):

#     @http.route('/matrix/data', type='json', auth='user')
#     def get_matrix_data(self, model, domain, row_fields, col_fields, measure_field):
#         records = request.env[model].search(domain)

#         matrix = defaultdict(lambda: defaultdict(float))
#         rows = set()
#         cols = set()
#         labels = {'rows': {}, 'cols': {}}

#         for record in records:
#             row_key = tuple(getattr(record, field).id if hasattr(getattr(record, field), 'id') else getattr(record, field) for field in row_fields)
#             col_key = tuple(getattr(record, field).id if hasattr(getattr(record, field), 'id') else getattr(record, field) for field in col_fields)

#             value = getattr(record, measure_field)
#             matrix[row_key][col_key] += value

#             rows.add(row_key)
#             cols.add(col_key)

#             labels['rows'][row_key] = [getattr(record, field).display_name if hasattr(getattr(record, field), 'display_name') else getattr(record, field) for field in row_fields]
#             labels['cols'][col_key] = [getattr(record, field).display_name if hasattr(getattr(record, field), 'display_name') else getattr(record, field) for field in col_fields]

#         return {
#             'matrix': {str(k): {str(subk): v for subk, v in subdict.items()} for k, subdict in matrix.items()},
#             'rows': list(rows),
#             'cols': list(cols),
#             'labels': labels,
#         }

    
class MatrixController(http.Controller):
    @http.route('/matrix/data', type='json', auth='user')
    def get_matrix_data(self, model, domain, row_fields, col_fields, measure_field):
        Model = request.env[model].with_context(request.context)
        return Model.get_matrix_data(row_fields, col_fields, measure_field, domain)