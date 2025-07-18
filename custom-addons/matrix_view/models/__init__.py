from . import matrix_view
from odoo import api
from functools import wraps

def matrix_api(func):
    """ Custom decorator based on @api.model with extra logging or checks if needed """
    @api.model
    @wraps(func)
    def wrapper(self,*args, **kwargs):
        values = args[0] if args else kwargs.get('values', {})
        print("********\n\n\nmatrix_api decorator called\n\n\n********")
        print("Values passed to the function:", values)
        rec = self.new(values)
        return func(rec)
    return wrapper

__all__ = ['matrix_api']