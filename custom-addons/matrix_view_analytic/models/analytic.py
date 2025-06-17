from odoo import api, fields, models,_
from odoo.tools import SQL, unique
from odoo.tools.float_utils import float_round, float_compare
from odoo.tools.misc import flatten
from odoo.exceptions import UserError, ValidationError

class AnalyticLine(models.Model):
    _inherit = "account.analytic.line"

    account_id = fields.Many2one(
        'account.analytic.account',
        'Project Account',
        ondelete='restrict',
        index=True,
        check_company=True,default=4
    )

    analytic_distribution = fields.Json(
        'Analytic Distribution',
        compute="_compute_analytic_distribution", store=True, copy=True, readonly=False,
    )
    
    @api.depends('account_id', 'company_id')
    def _compute_analytic_distribution(self):
        #pass
        for record in self:
            # record.analytic_distribution = {
            #     str(record.account_id.id): {
            #         'key': str(record.account_id.id),
            #         'value': record.amount,
            #         #'company_id': record.company_id.id,
            #     }
            # }
            record.analytic_distribution = {str(record.account_id.name):record.amount}

    

class ProductProduct(models.Model):
    _inherit = "product.product"
    _order = 'sequence, default_code, name, id'
    
    sequence = fields.Integer(
        string='Sequence',
        help="Gives the sequence order when displaying a list of products.",
        default=10,
    )

class MailThread(models.AbstractModel):
    _inherit = 'mail.thread'
    _description = 'Generic order retrieval for models'

    def get_order(self):
        return 'sequence, default_code, name, id'
        """
        Returns the default _order string defined on the model.
        If not explicitly set, returns 'id'.
        """
        print("get_order called",self._order)
        if hasattr(self, '_order'):
            return self._order
        if hasattr(self, '_order_fields'):
            return ', '.join(self._order_fields)
        if hasattr(self, 'display_name'):
            return 'display_name'
        if hasattr(self, 'id'):
            return 'id'
        return self._order or 'id'