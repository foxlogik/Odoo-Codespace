{
    'name': 'Analytic Matrix View',
    'version': '1.0',
    'summary': 'Analytic Matrix View for Odoo',
    'category': 'Tools',
    'depends': ['web','analytic','account','matrix_view'],
    'data': [
        'views/matrix_view.xml',
    ],
    'assets': {
        },
    'installable': True,
    'application': False,
}