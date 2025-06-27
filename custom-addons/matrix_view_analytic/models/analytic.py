from odoo import api, fields, models,_
from odoo.tools import SQL, unique
from odoo.tools.float_utils import float_round, float_compare
from odoo.tools.misc import flatten
from odoo.exceptions import UserError, ValidationError
import json

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
    date_time = fields.Datetime('DateTime', default=fields.Datetime.now,readonly=False)
    
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

    account_domain = fields.Binary(
        compute='_compute_account_domain',
        readonly=True,
        store=False,
    )

    product_domain = fields.Binary(
        compute='_compute_product_domain',
        readonly=True,
        store=False,
    )

    @api.depends('partner_id', 'company_id')
    def _compute_account_domain(self):
        for rec in self:
            domain = []
            
            #domain = [('id', 'in',[1,2,3] )]
            if rec.partner_id:
                domain = [('partner_id', '=', rec.partner_id.id)]
                accounts = self.env['account.analytic.account'].search(domain)
            else:
                domain = [
                    ('company_id', '=', rec.company_id.id),
                    ('active', '=', True),
                ]
                accounts = self.env['account.analytic.account'].search(domain)
            print("accounts", accounts)
            if (accounts):
                rec.account_domain = accounts.ids
            else:
                rec.account_domain = []

    @api.depends('company_id','write_date','create_date')
    def _compute_product_domain(self):
        print("********\n\n\ncompute product domain\n\n\n********")
        for rec in self:
            domain = []
            
            #domain = [('id', 'in',[1,2,3] )]
            domain = [
                ('sequence', '>=', 10),
                ('active', '=', True),
            ]

            print("domain", domain)
            products = self.env['product.product'].search(domain)
            print("products======", products)
            if (products):
                rec.product_domain = products.ids
            else:
                rec.product_domain = []

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
class MoveLine(models.Model):
    _inherit = "account.move.line"
    
    def open_analytic_items(self):
        """
        Open analytic items for the selected move lines.
        """
        self.ensure_one()
        action = self.env["ir.actions.actions"]._for_xml_id("analytic.account_analytic_line_action")
        action['domain'] = [('move_line_id', '=', self.id)]
        action['context'] = {
            'default_move_line_id': self.id,
            'default_company_id': self.company_id.id,
        }
        return action

class AnalyticAccount(models.Model):
    _inherit = "account.analytic.account"
    
    partner_ids = fields.Many2many('res.partner', string="Partners",)