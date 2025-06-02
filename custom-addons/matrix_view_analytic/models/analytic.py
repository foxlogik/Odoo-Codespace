from odoo import api, fields, models


class AnalyticLine(models.Model):
    _inherit = "account.analytic.line"

    account_id = fields.Many2one(
        'account.analytic.account',
        'Project Account',
        ondelete='restrict',
        index=True,
        check_company=True,default=4
    )